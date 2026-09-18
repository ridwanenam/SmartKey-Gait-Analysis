#include <Arduino.h>
#include <Arduino_LSM6DSOX.h>
#include "Config.h"
#include "StorageManager.h"
#include "FeatureExtraction.h"
#include "GHMMClassifier.h"
#include "BLEHandler.h"

// Objek Subsistem Perangkat Lunak
FeatureExtraction featureExtractor;
GHMMClassifier   ghmm;
BLEHandler       ble;

// Variabel Status & Konfigurasi Runtime
SystemState currentState = STATE_IDLE;
UserModel activeUsers[MAX_USERS];
uint8_t currentSlotTarget = 0;
uint8_t validWindowCounter = 0;
float trainingFeaturesBuffer[TARGET_WINDOWS][NUM_FEATURES];

// Variabel Penanda Waktu Non-Blocking (100 Hz = 10 ms)
unsigned long previousSampleTime = 0;
unsigned long calibrationStartTime = 0;
unsigned long lastCalibNotifyTime = 0;

// Variabel Akumulator Online Calibration (5 Detik)
float sumAccX = 0.0f, sumAccY = 0.0f, sumAccZ = 0.0f;
uint16_t calibSampleCount = 0;

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

    Serial.println(F("[OK] Sistem Smart Key Wearable Siap (Idle Mode)"));
}

void loop() {
    // 1. Polling Event Komunikasi BLE
    ble.poll();
    handleIncomingCommands();

    // 2. Scheduler Pengambilan Data IMU pada 100 Hz (10 ms)
    unsigned long currentMillis = millis();
    if (currentMillis - previousSampleTime >= IMU_SAMPLE_INTERVAL_MS) {
        previousSampleTime = currentMillis;

        float ax = 0, ay = 0, az = 0;
        float gx = 0, gy = 0, gz = 0;

        if (IMU.accelerationAvailable()) {
            IMU.readAcceleration(ax, ay, az);
        }
        if (IMU.gyroscopeAvailable()) {
            IMU.readGyroscope(gx, gy, gz);
        }

        // 3. Eksekusi Finite State Machine
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
        StorageManager::loadUser(i, activeUsers[i]);
    }
}

// Menangani string instruksi masuk dari Mobile App via BLE
void handleIncomingCommands() {
    char cmd[32];
    if (ble.hasNewCommand(cmd, sizeof(cmd))) {
        Serial.print(F("[BLE CMD] Diterima: "));
        Serial.println(cmd);

        // Perintah Mulai Registrasi: "TRAIN:<slot>" atau "START_REG"
        if (strncmp(cmd, "TRAIN:", 6) == 0 || strcmp(cmd, "START_REG") == 0) {
            currentSlotTarget = (strncmp(cmd, "TRAIN:", 6) == 0) ? atoi(&cmd[6]) : 0;
            if (currentSlotTarget < MAX_USERS) {
                sumAccX = sumAccY = sumAccZ = 0.0f;
                calibSampleCount = 0;
                calibrationStartTime = millis();
                lastCalibNotifyTime = millis();
                currentState = STATE_CALIBRATING;
                validWindowCounter = 0;
                featureExtractor.resetBuffer();

                // Segera kirim sinyal ke Mobile App: Status 2 = Memulai Kalibrasi Saku
                TelemetryData telem;
                memset(&telem, 0, sizeof(TelemetryData));
                telem.windowIndex = 0;
                telem.isZUPTValid = 2; // 2 = Calibrating Pocket
                telem.confidenceScore = 0.0f;
                ble.sendTelemetry(telem);

                Serial.print(F("[STATE] Memulai Online Calibration 5 Detik untuk Slot "));
                Serial.println(currentSlotTarget);
            }
        }
        // Perintah Mulai Autentikasi Langkah Kaki
        else if (strcmp(cmd, "START_AUTH") == 0) {
            featureExtractor.resetBuffer();
            ghmm.resetInference();
            validWindowCounter = 0;
            currentState = STATE_AUTHENTICATING;

            // Kirim notifikasi awal siap melangkah
            TelemetryData telem;
            memset(&telem, 0, sizeof(TelemetryData));
            telem.windowIndex = 0;
            telem.isZUPTValid = 1;
            ble.sendTelemetry(telem);

            Serial.println(F("[STATE] Memulai Sesi Autentikasi Berjalan..."));
        }
        // Perintah Batalkan Sesi Aktif
        else if (strcmp(cmd, "CANCEL") == 0) {
            currentState = STATE_IDLE;
            featureExtractor.resetBuffer();
            validWindowCounter = 0;
            Serial.println(F("[STATE] Sesi Dibatalkan -> Kembali ke Idle"));
        }
        // Perintah Hapus Satu User Tertentu: "DEL:<slot>" (Contoh: "DEL:1")
        else if (strncmp(cmd, "DEL:", 4) == 0) {
            uint8_t slotToDelete = atoi(&cmd[4]);
            StorageManager::deleteUser(slotToDelete);
            reloadUsersFromFlash();
            Serial.println(F("[STORAGE] Pengguna Berhasil Dihapus"));
        }
        // Perintah Hapus Seluruh User (Format All Flash)
        else if (strcmp(cmd, "DEL:ALL") == 0) {
            StorageManager::clearAllUsers();
            reloadUsersFromFlash();
            Serial.println(F("[STORAGE] Seluruh Memori Pengguna Diformat"));
        }
        // Emergency Action: Pembukaan Pintu Cepat via PIN Valid Mobile App
        else if (strcmp(cmd, "BYPASS_OPEN") == 0) {
            ble.sendDoorCommand("OPEN_DOOR");
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

// Fase 5 Detik Pertama: Mengunci Sudut Kemiringan Saku Pengguna
void processCalibrationState() {
    unsigned long now = millis();
    unsigned long elapsed = now - calibrationStartTime;

    // Kirim denyut berkala per 1 detik agar Mobile App menampilkan hitung mundur
    if (now - lastCalibNotifyTime >= 1000) {
        lastCalibNotifyTime = now;
        TelemetryData telem;
        memset(&telem, 0, sizeof(TelemetryData));
        telem.windowIndex = 0;
        telem.isZUPTValid = 2; // Status Kalibrasi
        telem.confidenceScore = (float)elapsed / 1000.0f; // 1.0 s.d. 5.0 detik
        ble.sendTelemetry(telem);
    }

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
        currentState = STATE_TRAINING;

        // Beritahu Mobile App bahwa kalibrasi selesai (isZUPTValid = 3) dan siap melangkah
        TelemetryData telem;
        memset(&telem, 0, sizeof(TelemetryData));
        telem.windowIndex = 0;
        telem.isZUPTValid = 3; // 3 = Selesai Kalibrasi, Mulai Melangkah
        telem.confidenceScore = 5.0f;
        ble.sendTelemetry(telem);

        Serial.println(F("[STATE] Kalibrasi Selesai -> Silakan Berjalan Normal"));
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
            telem.confidenceScore = (float)validWindowCounter * 10.0f; // Progres % registrasi

            Serial.print(F("[TRAIN] Jendela Valid Terkumpul: "));
            Serial.print(validWindowCounter);
            Serial.println(F("/10"));

            // Evaluasi Kuota 10 Jendela
            if (validWindowCounter >= TARGET_WINDOWS) {
                char userName[16];
                snprintf(userName, sizeof(userName), "User_%d", currentSlotTarget + 1);

                // Eksekusi Komputasi Awal Model GHMM
                ghmm.trainInitialModel(activeUsers[currentSlotTarget], trainingFeaturesBuffer, userName);
                StorageManager::saveUser(currentSlotTarget, activeUsers[currentSlotTarget]);

                Serial.println(F("[SUCCESS] Model GHMM Selesai & Tersimpan di Flash!"));
                ble.sendDoorCommand("TRAIN_SUCCESS");
                currentState = STATE_IDLE;
            }
        } else {
            // Jika diam/noise, pertahankan progres hitungan langkah yang sudah valid
            telem.windowIndex = validWindowCounter;
            telem.confidenceScore = (float)validWindowCounter * 10.0f;
            Serial.println(F("[ZUPT] Gerak Tidak Valid/Diam. Jendela Dibuang."));
        }

        // Kirim telemetri ke antarmuka aplikasi ponsel
        ble.sendTelemetry(telem);
        featureExtractor.resetBuffer();
    }
}

// Fase Autentikasi Harian Real-Time (Edge AI Inference & Adaptasi EMA)
void processAuthenticationState(float gx, float gy, float gz) {
    bool windowComplete = featureExtractor.addSample(gx, gy, gz);

    if (windowComplete) {
        bool isWalking = featureExtractor.evaluateZUPT();

        TelemetryData telem;
        memset(&telem, 0, sizeof(TelemetryData));
        telem.isZUPTValid = isWalking ? 1 : 0;

        if (isWalking) {
            float currentFeatures[NUM_FEATURES];
            featureExtractor.computeFeatures(currentFeatures);

            for (uint8_t d = 0; d < NUM_FEATURES; ++d) {
                telem.features[d] = currentFeatures[d];
            }

            validWindowCounter++;
            telem.windowIndex = validWindowCounter;

            // Evaluasi terhadap profil pemilik rumah utama (Slot 0)
            if (activeUsers[0].isRegistered) {
                float logProb = ghmm.evaluateWindow(activeUsers[0], currentFeatures, validWindowCounter);
                float confidence = ghmm.calculateConfidenceScore(logProb);

                telem.logLikelihood = logProb;
                telem.confidenceScore = confidence;
                telem.adaptiveThreshold = ghmm.getAdaptiveThreshold();

                // Evaluasi apakah akumulasi 10 jendela menembus syarat CIR >= 80%
                if (validWindowCounter >= TARGET_WINDOWS) {
                    if (confidence >= CONFIDENCE_HIGH_THRESHOLD) {
                        Serial.println(F("[AUTH] Autentikasi SAH! Membuka Pintu..."));
                        ble.sendDoorCommand("OPEN_DOOR");

                        // Eksekusi Incremental Personalization via formula EMA
                        float deltaEMA = ghmm.updateModelEMA(activeUsers[0], currentFeatures);
                        telem.emaDelta = deltaEMA;

                        // Perbarui data adaptif ke Flash memori internal
                        StorageManager::saveUser(0, activeUsers[0]);
                    } else {
                        Serial.println(F("[AUTH] Akses Ditolak: Pola Langkah Tidak Cocok!"));
                        ble.sendDoorCommand("ACCESS_DENIED");
                    }

                    currentState = STATE_IDLE;
                    validWindowCounter = 0;
                }
            } else {
                // Kasus cadangan jika pengguna belum didaftarkan di memori Flash
                Serial.println(F("[AUTH] Profil Pengguna Belum Terdaftar di Flash!"));
                telem.confidenceScore = 0.0f;
                telem.logLikelihood = -999.0f;

                if (validWindowCounter >= TARGET_WINDOWS) {
                    ble.sendDoorCommand("ACCESS_DENIED");
                    currentState = STATE_IDLE;
                    validWindowCounter = 0;
                }
            }
        } else {
            // Gerak tidak valid / diam, pertahankan indeks akumulasi
            telem.windowIndex = validWindowCounter;
            Serial.println(F("[ZUPT] Diam Terdeteksi -> Mengabaikan Jendela"));
        }

        // Kirim data metrik diagnostik ke Mobile App untuk live plot & simpan CSV
        ble.sendTelemetry(telem);
        featureExtractor.resetBuffer();
    }
}