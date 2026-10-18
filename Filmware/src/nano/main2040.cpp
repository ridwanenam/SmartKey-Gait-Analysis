#include <Arduino.h>
#include <Arduino_LSM6DSOX.h>
#include "Config.h"
#include "StorageManager.h"
#include "FeatureExtraction.h"
#include "GHMMClassifier.h"
#include "BLEHandler.h"

// Objek Subsistem Perangkat Lunak
FeatureExtraction featureExtractor;
GHMMClassifier   ghmm[MAX_USERS];
BLEHandler       ble;

// Variabel Status & Konfigurasi Runtime
SystemState currentState = STATE_IDLE;
UserModel activeUsers[MAX_USERS];
uint8_t currentSlotTarget = 0;
char targetUserName[16] = "User_1";
uint8_t validWindowCounter = 0;
float trainingFeaturesBuffer[TARGET_WINDOWS][NUM_FEATURES];

// Variabel Penanda Waktu Non-Blocking (100 Hz = 10 ms)
unsigned long previousSampleTime = 0;
unsigned long calibrationStartTime = 0;
unsigned long lastCalibNotifyTime = 0;

// Variabel Akumulator Online Calibration (500 ms)
float sumAccX = 0.0f, sumAccY = 0.0f, sumAccZ = 0.0f;
uint16_t calibSampleCount = 0;

enum CalibrationTarget {
    CALIB_TARGET_TRAINING,
    CALIB_TARGET_AUTH
};
CalibrationTarget calibTarget = CALIB_TARGET_TRAINING;

// Deklarasi Prototip Fungsi Internal
void handleIncomingCommands();
void processIdleState();
void processCalibrationState();
void processTrainingState(float gx, float gy, float gz);
void processAuthenticationState(float gx, float gy, float gz);
void reloadUsersFromFlash();

void setup() {
    Serial.begin(115200);

    // 1. Inisialisasi Sensor Inersia 6-Axis bawaan RP2040
    if (!IMU.begin()) {
        Serial.println(F("[ERR] Gagal inisialisasi sensor IMU LSM6DSOX!"));
        while (1);
    }

    // 2. Inisialisasi Modul Penyimpanan Flash & Muat Data Model
    StorageManager::begin();
    reloadUsersFromFlash();

    // 3. Inisialisasi Radio Nirkabel BLE
    if (!ble.begin()) {
        Serial.println(F("[ERR] Gagal mengaktifkan modul BLE RP2040!"));
        while (1);
    }

    Serial.println(F("[OK] Sistem Smart Key Wearable Siap (Multi-User Idle Mode)"));
}

void loop() {
    // 1. Polling Event Komunikasi BLE
    ble.poll();
    handleIncomingCommands();

    // 2. Scheduler Pengambilan Data IMU pada 100 Hz (10 ms)
    unsigned long currentMillis = millis();
    if (currentMillis - previousSampleTime >= IMU_SAMPLE_INTERVAL_MS) {
        previousSampleTime = currentMillis;

        // Gunakan static agar jika bus I2C belum siap pada siklus 10ms ini, nilai fisik terakhir dipertahankan (mencegah drop ke 0.0g)
        static float ax = 0.0f, ay = 0.0f, az = 1.0f;
        static float gx = 0.0f, gy = 0.0f, gz = 0.0f;

        if (IMU.accelerationAvailable()) {
            IMU.readAcceleration(ax, ay, az);
        }
        if (IMU.gyroscopeAvailable()) {
            IMU.readGyroscope(gx, gy, gz);
        }

        // 3. Streaming Gelombang Sensor Fisik Nyata (20 Hz / tiap 50 ms)
        static unsigned long lastLiveSampleTime = 0;
        if (currentMillis - lastLiveSampleTime >= 50) {
            lastLiveSampleTime = currentMillis;
            if (ble.isConnected() && (currentState == STATE_AUTHENTICATING || currentState == STATE_TRAINING || currentState == STATE_CALIBRATING)) {
                // Hitung magnitudo akselerasi dan hilangkan komponen gravitasi bumi 1.0g
                float accMag = sqrtf(ax * ax + ay * ay + az * az);
                float dynAcc = accMag - 1.0f; // 0.0g saat diam

                // Energi rotasi giroskop
                float gyroEnergy = (gx * gx + gy * gy + gz * gz);
                uint8_t isNowMoving = (gyroEnergy >= (ZUPT_ENERGY_THRESHOLD * 0.4f) || fabsf(dynAcc) > 0.12f) ? 1 : 0;

                // Tentukan nilai live waveform aktual
                float liveSignal = dynAcc;
                if (!isNowMoving && fabsf(dynAcc) < 0.04f) {
                    liveSignal = 0.0f; // Bersih 0.0g saat diam total
                }

                LiveSampleData liveData;
                liveData.liveVal = liveSignal;
                liveData.energy = gyroEnergy;
                liveData.isMoving = isNowMoving;
                ble.sendLiveSample(liveData);
            }
        }

        // 4. Eksekusi Finite State Machine
        switch (currentState) {
            case STATE_IDLE:
                processIdleState();
                break;

            case STATE_CALIBRATING:
                // Akumulasi data akselerometer untuk estimasi kemiringan awal saku
                sumAccX += ax;
                sumAccY += ay;
                sumAccZ += az;
                calibSampleCount++;
                processCalibrationState();
                break;

            case STATE_TRAINING:
                processTrainingState(gx, gy, gz);
                break;

            case STATE_AUTHENTICATING:
                processAuthenticationState(gx, gy, gz);
                break;
        }
    }
}

// Memuat ulang profil terdaftar dari Flash ke RAM
void reloadUsersFromFlash() {
    for (uint8_t i = 0; i < MAX_USERS; ++i) {
        UserModel loadedModel;
        bool ok = StorageManager::loadUser(i, loadedModel);
        if (ok && loadedModel.isRegistered) {
            activeUsers[i] = loadedModel;
        } else {
            activeUsers[i].isRegistered = false;
            memset(&activeUsers[i], 0, sizeof(UserModel));
            ghmm[i].resetInference();
        }
    }
}

// Menangani string instruksi masuk dari Mobile App via BLE
void handleIncomingCommands() {
    char cmd[32];
    if (ble.hasNewCommand(cmd, sizeof(cmd))) {
        Serial.print(F("[BLE CMD] Diterima: "));
        Serial.println(cmd);

        // Perintah Mulai Registrasi: "TRAIN:<slot>:<nama>" atau "TRAIN:<slot>" atau "START_REG"
        if (strncmp(cmd, "TRAIN:", 6) == 0 || strcmp(cmd, "START_REG") == 0) {
            currentSlotTarget = 0;
            strncpy(targetUserName, "User_1", sizeof(targetUserName) - 1);
            targetUserName[sizeof(targetUserName) - 1] = '\0';

            if (strncmp(cmd, "TRAIN:", 6) == 0) {
                // Format: TRAIN:<slot>:<nama> atau TRAIN:<slot>
                char *slotStr = &cmd[6];
                char *colon = strchr(slotStr, ':');
                if (colon != NULL) {
                    *colon = '\0';
                    currentSlotTarget = atoi(slotStr);
                    char *nameStr = colon + 1;
                    if (strlen(nameStr) > 0) {
                        strncpy(targetUserName, nameStr, sizeof(targetUserName) - 1);
                        targetUserName[sizeof(targetUserName) - 1] = '\0';
                    } else {
                        snprintf(targetUserName, sizeof(targetUserName), "User_%d", currentSlotTarget + 1);
                    }
                } else {
                    currentSlotTarget = atoi(slotStr);
                    snprintf(targetUserName, sizeof(targetUserName), "User_%d", currentSlotTarget + 1);
                }
            }

            if (currentSlotTarget < MAX_USERS) {
                calibTarget = CALIB_TARGET_TRAINING;
                sumAccX = sumAccY = sumAccZ = 0.0f;
                calibSampleCount = 0;
                calibrationStartTime = millis();
                lastCalibNotifyTime = millis();
                currentState = STATE_CALIBRATING;
                validWindowCounter = 0;
                featureExtractor.resetBuffer();

                // Segera kirim sinyal ke Mobile App: Status 2 = Penyelarasan Posisi Saku Cepat (500ms)
                TelemetryData telem;
                memset(&telem, 0, sizeof(TelemetryData));
                telem.windowIndex = 0;
                telem.isZUPTValid = 2; // 2 = Calibrating Pocket Otomatis
                telem.confidenceScore = 0.0f;
                ble.sendTelemetry(telem);

                Serial.print(F("[STATE] Memulai Penyelarasan Saku Otomatis 500ms untuk Registrasi Slot "));
                Serial.print(currentSlotTarget);
                Serial.print(F(" ("));
                Serial.print(targetUserName);
                Serial.println(F(")"));
            }
        }
        // Perintah Mulai Autentikasi Langkah Kaki
        else if (strcmp(cmd, "START_AUTH") == 0) {
            featureExtractor.resetBuffer();
            for (uint8_t i = 0; i < MAX_USERS; ++i) {
                ghmm[i].resetInference();
            }
            validWindowCounter = 0;

            // Masuk ke Kalibrasi Cepat 500ms otomatis sebelum autentikasi
            calibTarget = CALIB_TARGET_AUTH;
            sumAccX = sumAccY = sumAccZ = 0.0f;
            calibSampleCount = 0;
            calibrationStartTime = millis();
            lastCalibNotifyTime = millis();
            currentState = STATE_CALIBRATING;

            TelemetryData telem;
            memset(&telem, 0, sizeof(TelemetryData));
            telem.windowIndex = 0;
            telem.isZUPTValid = 2; // 2 = Calibrating Pocket Otomatis
            telem.confidenceScore = 0.0f;
            ble.sendTelemetry(telem);

            Serial.println(F("[STATE] Memulai Penyelarasan Saku Otomatis 500ms untuk Autentikasi..."));
        }
        // Perintah Batalkan Sesi Aktif
        else if (strcmp(cmd, "CANCEL") == 0) {
            currentState = STATE_IDLE;
            featureExtractor.resetBuffer();
            validWindowCounter = 0;
            Serial.println(F("[STATE] Sesi Dibatalkan -> Kembali ke Idle"));
        }
        // Perintah Sinkronisasi Status Flash Memori: "SYNC_FLASH" atau "GET_USERS"
        else if (strcmp(cmd, "SYNC_FLASH") == 0 || strcmp(cmd, "GET_USERS") == 0) {
            reloadUsersFromFlash();
            // Hanya kirim 4 slot (0 sampai 3) yang relevan dengan UI Mobile App
            // Berikan jeda 80ms antar paket agar BLE connection interval Nina W102 (45-75ms) tidak menumpuk/menimpa notifikasi
            for (uint8_t i = 0; i < 4; ++i) {
                char slotMsg[48];
                if (activeUsers[i].isRegistered) {
                    snprintf(slotMsg, sizeof(slotMsg), "FLASH_SLOT:%d:1:%s", i, activeUsers[i].userName);
                } else {
                    snprintf(slotMsg, sizeof(slotMsg), "FLASH_SLOT:%d:0:-", i);
                }
                ble.sendDoorCommand(slotMsg);
                delay(80); // Jeda transmisi aman BLE
            }
            delay(50);
            ble.sendDoorCommand("FLASH_SYNC_DONE");
            Serial.println(F("[STORAGE] Status Flash Memori Terkirim Lengkap ke Ponsel"));
        }
        // Perintah Hapus Satu User Tertentu: "DEL:<slot>" (Contoh: "DEL:1")
        else if (strncmp(cmd, "DEL:", 4) == 0) {
            if (strcmp(cmd, "DEL:ALL") == 0) {
                for (uint8_t i = 0; i < MAX_USERS; ++i) {
                    activeUsers[i].isRegistered = false;
                    memset(&activeUsers[i], 0, sizeof(UserModel));
                    ghmm[i].resetInference();
                }
                StorageManager::clearAllUsers();
                reloadUsersFromFlash();
                ble.sendDoorCommand("DEL_ALL_SUCCESS");
                Serial.println(F("[STORAGE] Seluruh Memori Pengguna Diformat"));
            } else {
                uint8_t slotToDelete = atoi(&cmd[4]);
                if (slotToDelete < MAX_USERS) {
                    activeUsers[slotToDelete].isRegistered = false;
                    memset(&activeUsers[slotToDelete], 0, sizeof(UserModel));
                    ghmm[slotToDelete].resetInference();
                    StorageManager::deleteUser(slotToDelete);
                    reloadUsersFromFlash();
                    char delMsg[32];
                    snprintf(delMsg, sizeof(delMsg), "DEL_SUCCESS:%d", slotToDelete);
                    ble.sendDoorCommand(delMsg);
                    Serial.print(F("[STORAGE] Pengguna Slot Dihapus: "));
                    Serial.println(slotToDelete);
                }
            }
        }
        // Emergency Action: Pembukaan Pintu Cepat via PIN Valid Mobile App
        else if (strcmp(cmd, "BYPASS_OPEN") == 0) {
            ble.sendDoorCommand("OPEN_DOOR:PIN_BYPASS");
            Serial.println(F("[FAIL-SAFE] Emergency Bypass Aktif: Membuka Pintu!"));
        }
        // Manual Door Lock: Kunci Pintu Manual dari Mobile App
        else if (strcmp(cmd, "LOCK_DOOR") == 0 || strcmp(cmd, "LOCK_MANUAL") == 0) {
            ble.sendDoorCommand("CLOSE_DOOR");
            Serial.println(F("[CONTROL] Perintah Kunci Manual -> Pintu Dikunci!"));
        }
    }
}

void processIdleState() {
    // Mode siaga daya rendah
}

// Fase Kalibrasi Saku Cepat Otomatis (500 ms)
void processCalibrationState() {
    unsigned long now = millis();
    unsigned long elapsed = now - calibrationStartTime;

    if (elapsed >= CALIBRATION_DURATION_MS) {
        if (calibSampleCount > 0) {
            float meanAx = sumAccX / (float)calibSampleCount;
            float meanAy = sumAccY / (float)calibSampleCount;
            float meanAz = sumAccZ / (float)calibSampleCount;

            // Rumus Trigonometri Roll (phi) dan Pitch (theta)
            float roll  = atan2f(meanAy, sqrtf(meanAx * meanAx + meanAz * meanAz));
            float pitch = atan2f(-meanAx, sqrtf(meanAy * meanAy + meanAz * meanAz));

            featureExtractor.setOrientationOffsets(roll, pitch);
        }

        featureExtractor.resetBuffer();
        validWindowCounter = 0;

        if (calibTarget == CALIB_TARGET_AUTH) {
            currentState = STATE_AUTHENTICATING;
            Serial.println(F("[STATE] Penyelarasan Saku 500ms Selesai -> Siap Autentikasi Langkah"));
        } else {
            currentState = STATE_TRAINING;
            Serial.println(F("[STATE] Penyelarasan Saku 500ms Selesai -> Siap Registrasi Langkah"));
        }

        // Beritahu Mobile App bahwa kalibrasi selesai (isZUPTValid = 3) dan siap melangkah
        TelemetryData telem;
        memset(&telem, 0, sizeof(TelemetryData));
        telem.windowIndex = 0;
        telem.isZUPTValid = 3; // 3 = Selesai Kalibrasi, Mulai Melangkah
        telem.confidenceScore = 0.0f;
        ble.sendTelemetry(telem);
    }
}

// Fase Pendaftaran Mandiri On-Device (Edge Training 10 Jendela)
void processTrainingState(float gx, float gy, float gz) {
    bool windowComplete = featureExtractor.addSample(gx, gy, gz);

    if (windowComplete) {
        bool isWalking = featureExtractor.evaluateZUPT();

        TelemetryData telem;
        memset(&telem, 0, sizeof(TelemetryData));
        telem.isZUPTValid = isWalking ? 1 : 0;

        if (isWalking) {
            float currentFeatures[NUM_FEATURES];
            featureExtractor.computeFeatures(currentFeatures);

            // Simpan fitur jendela valid ke buffer training
            for (uint8_t d = 0; d < NUM_FEATURES; ++d) {
                trainingFeaturesBuffer[validWindowCounter][d] = currentFeatures[d];
                telem.features[d] = currentFeatures[d];
            }

            validWindowCounter++;
            telem.windowIndex = validWindowCounter;
            telem.confidenceScore = (float)validWindowCounter * (100.0f / (float)TARGET_WINDOWS); // Progres % registrasi

            Serial.print(F("[TRAIN] Jendela Valid Terkumpul: "));
            Serial.print(validWindowCounter);
            Serial.print(F("/"));
            Serial.println(TARGET_WINDOWS);

            // Evaluasi Kuota Jendela Valid
            if (validWindowCounter >= TARGET_WINDOWS) {
                // Kirim telemetri jendela ke-5 terlebih dahulu sebelum proses komputasi & event sukses
                ble.sendTelemetry(telem);
                featureExtractor.resetBuffer();
                delay(50);

                // Eksekusi Komputasi Awal Model GHMM untuk target user
                ghmm[currentSlotTarget].trainInitialModel(activeUsers[currentSlotTarget], trainingFeaturesBuffer, targetUserName);
                bool saveOk = StorageManager::saveUser(currentSlotTarget, activeUsers[currentSlotTarget]);
                if (!saveOk) {
                    Serial.print(F("[STORAGE ERROR] Gagal menulis ke Flash! Mengulang kv_remove & kv_set... "));
                    StorageManager::deleteUser(currentSlotTarget);
                    saveOk = StorageManager::saveUser(currentSlotTarget, activeUsers[currentSlotTarget]);
                    Serial.println(saveOk ? F("SUKSES") : F("GAGAL"));
                }

                Serial.print(F("[SUCCESS] Model GHMM "));
                Serial.print(targetUserName);
                Serial.println(F(" Selesai & Tersimpan di Flash!"));

                char trainSuccessMsg[32];
                snprintf(trainSuccessMsg, sizeof(trainSuccessMsg), "TRAIN_SUCCESS:%d:%s", currentSlotTarget, activeUsers[currentSlotTarget].userName);
                ble.sendDoorCommand(trainSuccessMsg);
                currentState = STATE_IDLE;
            } else {
                ble.sendTelemetry(telem);
                featureExtractor.slideBuffer(); // Sliding window 50% untuk kesinambungan siklus langkah
            }
        } else {
            // Jika diam/noise, pertahankan progres hitungan langkah yang sudah valid
            telem.windowIndex = validWindowCounter;
            telem.confidenceScore = (float)validWindowCounter * (100.0f / (float)TARGET_WINDOWS);
            Serial.println(F("[ZUPT] Gerak Tidak Valid/Diam. Jendela Dibuang."));
            ble.sendTelemetry(telem);
            featureExtractor.resetBuffer();
        }
    }
}

// Fase Autentikasi Harian Real-Time (Edge AI Inference Multi-User & Adaptasi EMA)
void processAuthenticationState(float gx, float gy, float gz) {
    bool windowComplete = featureExtractor.addSample(gx, gy, gz);

    if (windowComplete) {
        bool isWalking = featureExtractor.evaluateZUPT();

        TelemetryData telem;
        memset(&telem, 0, sizeof(TelemetryData));
        telem.isZUPTValid = isWalking ? 1 : 0;

        int bestUserIdx = -1;
        float bestConfidence = -1.0f;
        float bestLogProb = -999.0f;
        float userScores[MAX_USERS];
        for (uint8_t i = 0; i < MAX_USERS; ++i) {
            userScores[i] = -1.0f;
        }

        if (isWalking) {
            float currentFeatures[NUM_FEATURES];
            featureExtractor.computeFeatures(currentFeatures);

            for (uint8_t d = 0; d < NUM_FEATURES; ++d) {
                telem.features[d] = currentFeatures[d];
            }

            validWindowCounter++;
            telem.windowIndex = validWindowCounter;

            // Evaluasi terhadap seluruh profil pemilik yang terdaftar (Multiclass 1-vs-All)
            for (uint8_t i = 0; i < MAX_USERS; ++i) {
                if (activeUsers[i].isRegistered) {
                    float logProb = ghmm[i].evaluateWindow(activeUsers[i], currentFeatures, validWindowCounter);
                    float conf = ghmm[i].calculateConfidenceScore(logProb);
                    userScores[i] = conf;
                    if (conf > bestConfidence) {
                        bestConfidence = conf;
                        bestLogProb = logProb;
                        bestUserIdx = i;
                    }
                }
            }

            if (bestUserIdx >= 0) {
                telem.logLikelihood = bestLogProb;
                telem.confidenceScore = bestConfidence;
                telem.adaptiveThreshold = ghmm[bestUserIdx].getAdaptiveThreshold();

                // Eksekusi Incremental Personalization via formula EMA jika sudah mencapai TARGET_WINDOWS dan sangat yakin (>= 90%)
                if (validWindowCounter >= TARGET_WINDOWS && bestConfidence >= 90.0f) {
                    float deltaEMA = ghmm[bestUserIdx].updateModelEMA(activeUsers[bestUserIdx], currentFeatures);
                    telem.emaDelta = deltaEMA;
                    // Perbarui data adaptif ke Flash memori internal
                    StorageManager::saveUser(bestUserIdx, activeUsers[bestUserIdx]);
                } else {
                    telem.emaDelta = 0.0f;
                }
            } else {
                // Kasus jika belum ada profil pengguna terdaftar di memori Flash
                Serial.println(F("[AUTH] Profil Pengguna Belum Terdaftar di Flash!"));
                telem.confidenceScore = 0.0f;
                telem.logLikelihood = -999.0f;
                telem.adaptiveThreshold = 0.0f;
                telem.emaDelta = 0.0f;
            }
        } else {
            // Gerak tidak valid / diam, pertahankan indeks akumulasi
            telem.windowIndex = validWindowCounter;
            Serial.println(F("[ZUPT] Diam Terdeteksi -> Mengabaikan Jendela"));
        }

        // 1. KIRIM DATA TELEMETRI KE APLIKASI PONSEL TERLEBIH DAHULU (Pastikan Jendela #5 tercatat di aplikasi)
        ble.sendTelemetry(telem);

        // 2. Evaluasi apakah akumulasi 5 jendela selesai
        if (isWalking && validWindowCounter >= TARGET_WINDOWS) {
            featureExtractor.resetBuffer();
            delay(50); // Beri ruang stack BLE mentransmisikan paket telemetri jendela ke-5 sebelum event pintu

            if (bestUserIdx >= 0) {
                // Kirim breakdown skor kemiripan seluruh slot yang terdaftar ke Mobile App
                char scoresMsg[64];
                int offset = snprintf(scoresMsg, sizeof(scoresMsg), "SCORES:");
                for (uint8_t i = 0; i < MAX_USERS; ++i) {
                    if (activeUsers[i].isRegistered && offset < (int)sizeof(scoresMsg) - 10) {
                        offset += snprintf(scoresMsg + offset, sizeof(scoresMsg) - offset, "%d:%.1f|", i, userScores[i]);
                    }
                }
                if (offset > 7 && scoresMsg[offset - 1] == '|') {
                    scoresMsg[offset - 1] = '\0';
                }
                ble.sendDoorCommand(scoresMsg);
                delay(40);

                if (bestConfidence >= CONFIDENCE_HIGH_THRESHOLD) {
                    Serial.print(F("[AUTH] Autentikasi SAH untuk: "));
                    Serial.println(activeUsers[bestUserIdx].userName);

                    char doorMsg[32];
                    snprintf(doorMsg, sizeof(doorMsg), "OPEN_DOOR:%s", activeUsers[bestUserIdx].userName);
                    ble.sendDoorCommand(doorMsg);
                } else {
                    Serial.println(F("[AUTH] Akses Ditolak: Pola Langkah Tidak Cocok!"));
                    ble.sendDoorCommand("ACCESS_DENIED");
                }
            } else {
                ble.sendDoorCommand("ACCESS_DENIED");
            }

            currentState = STATE_IDLE;
            validWindowCounter = 0;
        } else if (isWalking) {
            // Geser buffer dengan sliding window 50% untuk kesinambungan siklus langkah
            featureExtractor.slideBuffer();
        } else {
            // Gerak tidak valid / diam, bersihkan buffer agar tidak ada sisa artefak statis
            featureExtractor.resetBuffer();
        }
    }
}