#include <Arduino.h>
#include <Arduino_LSM6DSOX.h>
#include <mbed.h>
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
char targetUserName[32] = "User_1";
uint8_t validWindowCounter = 0;
float trainingFeaturesBuffer[TARGET_WINDOWS][NUM_FEATURES];

// Penanda re-advertising aman non-blocking (bebas deadlock SPI)
volatile bool g_bleNeedsAdvertise = false;

// Variabel Penanda Waktu Non-Blocking (100 Hz = 10 ms)
unsigned long previousSampleTime = 0;

// Watchdog Heartbeat Non-Blocking untuk auto-recovery saat hang / SPI deadlock
// Menggunakan mbed::Ticker & CMSIS NVIC_SystemReset() tanpa mengaktifkan register bootrom watchdog silicon
constexpr uint32_t WATCHDOG_HEARTBEAT_TIMEOUT_MS = 8000; // 8 detik batas toleransi hang
volatile uint32_t g_lastLoopHeartbeat = 0;
mbed::Ticker g_watchdogTicker;

void watchdogCheckCallback() {
    if (g_lastLoopHeartbeat > 0 && (millis() - g_lastLoopHeartbeat > WATCHDOG_HEARTBEAT_TIMEOUT_MS)) {
        NVIC_SystemReset();
    }
}

// Deklarasi Prototip Fungsi Internal
void handleIncomingCommands();
void processIdleState();
void processTrainingState(float ax, float ay, float az, float gx, float gy, float gz);
void processAuthenticationState(float ax, float ay, float az, float gx, float gy, float gz);
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

    // 4. Aktifkan Software Heartbeat Watchdog (Periksa tiap 1.0 detik)
    g_lastLoopHeartbeat = millis();
    g_watchdogTicker.attach(&watchdogCheckCallback, std::chrono::seconds(1));

    Serial.println(F("[OK] Sistem Smart Key Wearable Siap (Multi-User Idle Mode)"));
}

void loop() {
    // 0. Update Heartbeat Watchdog
    g_lastLoopHeartbeat = millis();

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
            if (ble.isConnected() && (currentState == STATE_AUTHENTICATING || currentState == STATE_TRAINING)) {
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

            case STATE_TRAINING:
                processTrainingState(ax, ay, az, gx, gy, gz);
                break;

            case STATE_AUTHENTICATING:
                processAuthenticationState(ax, ay, az, gx, gy, gz);
                break;
        }
    }

    // 5. Jeda Perlindungan Bus SPI & Pencegahan Deadlock Nina-W102 saat Idle
    // Mencegah looping 133 MHz membanjiri buffer komunikasi modul radio BLE
    if (currentState == STATE_IDLE) {
        delay(2);
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
    char cmd[64];
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
                validWindowCounter = 0;
                featureExtractor.resetBuffer();
                currentState = STATE_TRAINING;

                TelemetryData telem;
                memset(&telem, 0, sizeof(TelemetryData));
                telem.windowIndex = 0;
                telem.isZUPTValid = 0;
                telem.confidenceScore = 0.0f;
                ble.sendTelemetry(telem);

                Serial.print(F("[STATE] Memulai Registrasi Langkah (Invarian Orientasi) Slot "));
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
            currentState = STATE_AUTHENTICATING;

            TelemetryData telem;
            memset(&telem, 0, sizeof(TelemetryData));
            telem.windowIndex = 0;
            telem.isZUPTValid = 0;
            telem.confidenceScore = 0.0f;
            ble.sendTelemetry(telem);

            Serial.println(F("[STATE] Memulai Autentikasi Langkah (Invarian Orientasi)..."));
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
            // Kirim seluruh slot (0 sampai MAX_USERS-1) yang relevan dengan UI Mobile App
            // Berikan jeda 80ms antar paket agar BLE connection interval Nina W102 (45-75ms) tidak menumpuk/menimpa notifikasi
            for (uint8_t i = 0; i < MAX_USERS; ++i) {
                char slotMsg[64];
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
                    activeUsers[slotToDelete].isRegistered = false;
                    char delMsg[32];
                    snprintf(delMsg, sizeof(delMsg), "DEL_SUCCESS:%d", slotToDelete);
                    ble.sendDoorCommand(delMsg);
                    Serial.print(F("[STORAGE] Pengguna Slot Dihapus: "));
                    Serial.println(slotToDelete);
                }
            }
        }
        // Perintah Ganti Nama User Slot: "RENAME:<slot>:<newName>" (Contoh: "RENAME:0:ridwan biasa")
        else if (strncmp(cmd, "RENAME:", 7) == 0) {
            char *slotStr = &cmd[7];
            char *colon = strchr(slotStr, ':');
            if (colon != NULL) {
                *colon = '\0';
                uint8_t slotToRename = atoi(slotStr);
                char *newName = colon + 1;
                if (slotToRename < MAX_USERS && strlen(newName) > 0) {
                    strncpy(activeUsers[slotToRename].userName, newName, sizeof(activeUsers[slotToRename].userName) - 1);
                    activeUsers[slotToRename].userName[sizeof(activeUsers[slotToRename].userName) - 1] = '\0';
                    if (activeUsers[slotToRename].isRegistered) {
                        bool saveOk = StorageManager::saveUser(slotToRename, activeUsers[slotToRename]);
                        if (!saveOk) {
                            Serial.println(F("[STORAGE ERROR] Gagal menyimpan nama baru ke Flash!"));
                        }
                    }
                    char renameMsg[64];
                    snprintf(renameMsg, sizeof(renameMsg), "RENAME_SUCCESS:%d:%s", slotToRename, activeUsers[slotToRename].userName);
                    ble.sendDoorCommand(renameMsg);
                    Serial.print(F("[STORAGE] Nama Slot "));
                    Serial.print(slotToRename);
                    Serial.print(F(" Diubah Menjadi: "));
                    Serial.println(activeUsers[slotToRename].userName);
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

// Fase Pendaftaran Mandiri On-Device (Edge Training 10 Jendela)
void processTrainingState(float ax, float ay, float az, float gx, float gy, float gz) {
    bool windowComplete = featureExtractor.addSample(ax, ay, az, gx, gy, gz);

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
                    Serial.println(F("[STORAGE ERROR] Gagal menulis ke Flash! Mengulang saveUser..."));
                    saveOk = StorageManager::saveUser(currentSlotTarget, activeUsers[currentSlotTarget]);
                    Serial.println(saveOk ? F("[STORAGE] Retry SUKSES") : F("[STORAGE] Retry GAGAL"));
                }

                if (saveOk) {
                    Serial.print(F("[SUCCESS] Model GHMM "));
                    Serial.print(targetUserName);
                    Serial.println(F(" Selesai & Tersimpan di Flash!"));

                    char trainSuccessMsg[64];
                    snprintf(trainSuccessMsg, sizeof(trainSuccessMsg), "TRAIN_SUCCESS:%d:%s", currentSlotTarget, activeUsers[currentSlotTarget].userName);
                    ble.sendDoorCommand(trainSuccessMsg);
                } else {
                    Serial.println(F("[ERR] Gagal menyimpan model ke Flash! Membatalkan slot."));
                    activeUsers[currentSlotTarget].isRegistered = false;
                    ghmm[currentSlotTarget].resetInference();
                    ble.sendDoorCommand("TRAIN_FAILED:STORAGE_ERROR");
                }
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

// Fungsi pembanding prefix nama pengguna untuk mengidentifikasi apakah 2 slot milik orang yang sama
// Contoh: "ridwan jln" dan "ridwan jln cpt" -> kata pertama "ridwan" sama -> return true
static bool isSameUserPrefix(const char *nameA, const char *nameB) {
    if (!nameA || !nameB || nameA[0] == '\0' || nameB[0] == '\0') return false;
    
    // Cari batas kata pertama (sebelum spasi ' ', underscore '_', atau strip '-')
    size_t lenA = 0;
    while (nameA[lenA] && nameA[lenA] != ' ' && nameA[lenA] != '_' && nameA[lenA] != '-') lenA++;
    
    size_t lenB = 0;
    while (nameB[lenB] && nameB[lenB] != ' ' && nameB[lenB] != '_' && nameB[lenB] != '-') lenB++;
    
    // Jika kata pertama sama (case-insensitive) dan minimal 2 huruf
    if (lenA >= 2 && lenA == lenB) {
        if (strncasecmp(nameA, nameB, lenA) == 0) return true;
    }
    
    // Jika salah satu nama adalah awalan penuh dari nama lainnya (misal "ridwan" vs "ridwan_cepat")
    size_t minLen = (strlen(nameA) < strlen(nameB)) ? strlen(nameA) : strlen(nameB);
    if (minLen >= 3 && strncasecmp(nameA, nameB, minLen) == 0) return true;
    
    return false;
}

// Fase Autentikasi Harian Real-Time (Edge AI Inference Multi-User GHMM)
void processAuthenticationState(float ax, float ay, float az, float gx, float gy, float gz) {
    bool windowComplete = featureExtractor.addSample(ax, ay, az, gx, gy, gz);

    if (windowComplete) {
        bool isWalking = featureExtractor.evaluateZUPT();

        TelemetryData telem;
        memset(&telem, 0, sizeof(TelemetryData));
        telem.isZUPTValid = isWalking ? 1 : 0;

        int bestUserIdx = -1;
        float bestConfidence = -1.0f;
        float bestLogProb = -999.0f;
        int runnerUpUserIdx = -1;
        float runnerUpConfidence = -1.0f;
        float userScores[MAX_USERS];
        for (uint8_t i = 0; i < MAX_USERS; ++i) {
            userScores[i] = -1.0f;
        }

        // Variabel penampung rata-rata kinematika & penempatan sesi uji (5 jendela)
        static float sessionFeaturesSum[NUM_FEATURES] = {0};
        static float sessionThighExcursionSum = 0.0f;
        static float sessionCrestFactorSum = 0.0f;
        static float sessionAxisDominanceSum = 0.0f;
        static float sessionNormJerkSum = 0.0f;
        static float sessionAsymSum = 0.0f;

        // Variabel evaluasi gerbang fisik sesi
        bool isKinematicallyValid = true;
        bool isPantsPocketPlacement = true;
        float avgFeatures[NUM_FEATURES] = {0};
        float avgThighExcursion = 0.0f;
        float avgCrestFactor = 0.0f;
        float avgAxisDominance = 0.0f;
        float avgNormJerk = 0.0f;
        float avgAsym = 0.0f;
        uint8_t deviasiCount = 0;
        float deltaGyro = 0.0f;

        if (isWalking) {
            float currentFeatures[NUM_FEATURES];
            featureExtractor.computeFeatures(currentFeatures);

            for (uint8_t d = 0; d < NUM_FEATURES; ++d) {
                telem.features[d] = currentFeatures[d];
            }

            validWindowCounter++;
            telem.windowIndex = validWindowCounter;

            // Inisialisasi akumulator sesi pada awal jendela ke-1
            if (validWindowCounter == 1) {
                for (uint8_t d = 0; d < NUM_FEATURES; ++d) {
                    sessionFeaturesSum[d] = 0.0f;
                }
                sessionThighExcursionSum = 0.0f;
                sessionCrestFactorSum = 0.0f;
                sessionAxisDominanceSum = 0.0f;
                sessionNormJerkSum = 0.0f;
                sessionAsymSum = 0.0f;
            }

            for (uint8_t d = 0; d < NUM_FEATURES; ++d) {
                sessionFeaturesSum[d] += currentFeatures[d];
            }
            sessionThighExcursionSum += featureExtractor.computeThighExcursion();
            sessionCrestFactorSum += featureExtractor.computeImpactCrestFactor();
            sessionAxisDominanceSum += featureExtractor.computeAxisDominanceRatio();
            sessionNormJerkSum += featureExtractor.computeNormalizedJerkIndex();
            sessionAsymSum += featureExtractor.computeSwingStanceAsymmetry();

            // Evaluasi terhadap seluruh profil pemilik yang terdaftar (Multiclass 1-vs-All)
            for (uint8_t i = 0; i < MAX_USERS; ++i) {
                if (activeUsers[i].isRegistered) {
                    float logProb = ghmm[i].evaluateWindow(activeUsers[i], currentFeatures, validWindowCounter);
                    float conf = ghmm[i].calculateConfidenceScore(logProb);
                    userScores[i] = conf;
                    if (conf > bestConfidence) {
                        runnerUpConfidence = bestConfidence;
                        runnerUpUserIdx = bestUserIdx;
                        bestConfidence = conf;
                        bestLogProb = logProb;
                        bestUserIdx = i;
                    } else if (conf > runnerUpConfidence) {
                        runnerUpConfidence = conf;
                        runnerUpUserIdx = i;
                    }
                }
            }

            if (bestUserIdx >= 0) {

                // Pada jendela ke-5 (selesai), evaluasi gerbang kinematika fisik & penempatan saku
                if (validWindowCounter >= TARGET_WINDOWS) {
                    for (uint8_t d = 0; d < NUM_FEATURES; ++d) {
                        avgFeatures[d] = sessionFeaturesSum[d] / (float)TARGET_WINDOWS;
                    }
                    avgThighExcursion = sessionThighExcursionSum / (float)TARGET_WINDOWS;
                    avgCrestFactor = sessionCrestFactorSum / (float)TARGET_WINDOWS;
                    avgAxisDominance = sessionAxisDominanceSum / (float)TARGET_WINDOWS;
                    avgNormJerk = sessionNormJerkSum / (float)TARGET_WINDOWS;
                    avgAsym = sessionAsymSum / (float)TARGET_WINDOWS;

                    float modelAvgGyro = 0.5f * (activeUsers[bestUserIdx].means[0][0] + activeUsers[bestUserIdx].means[1][0]);
                    deltaGyro = fabsf(avgFeatures[0] - modelAvgGyro);

                    deviasiCount = 0;
                    if (deltaGyro > 18.0f) deviasiCount++;
                    if (fabsf(avgFeatures[1] - 0.5f * (activeUsers[bestUserIdx].means[0][1] + activeUsers[bestUserIdx].means[1][1])) > 15.0f) deviasiCount++;
                    if (fabsf(avgFeatures[2] - 0.5f * (activeUsers[bestUserIdx].means[0][2] + activeUsers[bestUserIdx].means[1][2])) > 20.0f) deviasiCount++;
                    if (fabsf(avgFeatures[3] - 0.5f * (activeUsers[bestUserIdx].means[0][3] + activeUsers[bestUserIdx].means[1][3])) > 12.0f) deviasiCount++;
                    if (fabsf(avgFeatures[4] - 0.5f * (activeUsers[bestUserIdx].means[0][4] + activeUsers[bestUserIdx].means[1][4])) > 18.0f) deviasiCount++;

                    // Gerbang Kinematika Fisik (Anti-Ayun Tangan Bebas - Calibrated)
                    // Ayunan tangan bebas di udara:
                    // 1) Memiliki dominansi sumbu tunggal pendulum ekstrem (> 0.88, empiris ayun tangan: 0.94 - 0.97)
                    // 2) Tidak memiliki hentakan mekanis tapak kaki / heel-strike ke tanah (NormJerk < 0.28, empiris ayun: 0.19 - 0.25)
                    bool isHandSwing = (avgAxisDominance > 0.88f) || (avgNormJerk < 0.28f);
                    isKinematicallyValid = (deviasiCount < 2) && (deltaGyro <= 22.0f) && !isHandSwing;

                    // Gerbang Penempatan Saku Celana (Anti-Saku Jaket / Torso - Calibrated)
                    // Saku jaket di torso memiliki ekskursi ayunan sangat sempit (< 30.0 deg, empiris torso: 19 - 29 deg).
                    // Gerakan paha melangkah sejati memiliki ekskursi lebar (> 40.0 deg, teman/Rein mencapai 82 - 89 deg).
                    bool isTorsoJacket = (avgThighExcursion < 30.0f) || 
                                         (avgThighExcursion < 35.0f && avgAsym < 1.35f);
                    isPantsPocketPlacement = !isTorsoJacket;

                    // Fused Kinematic & Placement Penalization:
                    // Jika terjadi veto kinematika atau penempatan non-gait, jatuhkan SELURUH skor slot kandidat ke < 28%
                    // agar tidak ada profil yang menampilkan persentase tinggi saat ayun tangan atau saku jaket
                    if (!isKinematicallyValid || !isPantsPocketPlacement) {
                        for (uint8_t i = 0; i < MAX_USERS; ++i) {
                            if (activeUsers[i].isRegistered) {
                                userScores[i] = fminf(userScores[i] * 0.30f, 28.0f);
                            }
                        }
                        bestConfidence = fminf(bestConfidence * 0.30f, 28.0f);
                    }
                }

                telem.logLikelihood = bestLogProb;
                telem.confidenceScore = bestConfidence;
                telem.adaptiveThreshold = ghmm[bestUserIdx].getAdaptiveThreshold();

                // EMA adaptif dinonaktifkan demi integritas model deterministik, pencegahan template drift, dan keausan memori Flash
                telem.emaDelta = 0.0f;
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
                char scoresMsg[96];
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

                // Kirim paket diagnostik gerbang fisik (Tahap 0: Shadow Mode Diagnostics)
                char gatesMsg[64];
                snprintf(gatesMsg, sizeof(gatesMsg), "GATES:j=%.3f|a=%.2f|ex=%.1f|cf=%.2f|ad=%.2f|dG=%.1f",
                    avgNormJerk, avgAsym, avgThighExcursion, avgCrestFactor, avgAxisDominance, deltaGyro);
                ble.sendDoorCommand(gatesMsg);
                delay(40);

                Serial.print(F("[SHADOW GATES] NormJerk: "));
                Serial.print(avgNormJerk, 3);
                Serial.print(F(" | Asym: "));
                Serial.print(avgAsym, 2);
                Serial.print(F(" | Excursion: "));
                Serial.print(avgThighExcursion, 1);
                Serial.print(F(" deg | Crest: "));
                Serial.print(avgCrestFactor, 2);
                Serial.print(F(" | AxisDom: "));
                Serial.print(avgAxisDominance, 2);
                Serial.print(F(" | DeltaGyro: "));
                Serial.println(deltaGyro, 1);

                // 1. Cek Margin Separasi terhadap runner-up (dikecualikan jika pemilik sama)
                float maxForeignConfidence = -1.0f;
                int foreignUserIdx = -1;
                for (uint8_t i = 0; i < MAX_USERS; ++i) {
                    if (activeUsers[i].isRegistered && (int)i != bestUserIdx) {
                        if (!isSameUserPrefix(activeUsers[bestUserIdx].userName, activeUsers[i].userName)) {
                            if (userScores[i] > maxForeignConfidence) {
                                maxForeignConfidence = userScores[i];
                                foreignUserIdx = i;
                            }
                        }
                    }
                }

                bool isRunnerUpSameUser = (runnerUpUserIdx >= 0) && 
                    isSameUserPrefix(activeUsers[bestUserIdx].userName, activeUsers[runnerUpUserIdx].userName);

                bool hasCleanMargin = false;
                if (isRunnerUpSameUser) {
                    hasCleanMargin = (maxForeignConfidence < 0.0f) || ((bestConfidence - maxForeignConfidence) >= SEPARATION_MARGIN_MIN);
                } else {
                    hasCleanMargin = (runnerUpConfidence < 0.0f) || ((bestConfidence - runnerUpConfidence) >= SEPARATION_MARGIN_MIN);
                }

                // 2. Evaluasi Rata-Rata Kinematika Sesi Uji vs Model Golden Pemenang
                for (uint8_t d = 0; d < NUM_FEATURES; ++d) {
                    avgFeatures[d] = sessionFeaturesSum[d] / (float)TARGET_WINDOWS;
                }
                avgThighExcursion = sessionThighExcursionSum / (float)TARGET_WINDOWS;
                avgCrestFactor = sessionCrestFactorSum / (float)TARGET_WINDOWS;
                avgAxisDominance = sessionAxisDominanceSum / (float)TARGET_WINDOWS;
                avgNormJerk = sessionNormJerkSum / (float)TARGET_WINDOWS;
                avgAsym = sessionAsymSum / (float)TARGET_WINDOWS;

                float modelAvgGyro = 0.5f * (activeUsers[bestUserIdx].means[0][0] + activeUsers[bestUserIdx].means[1][0]);
                deltaGyro = fabsf(avgFeatures[0] - modelAvgGyro);

                deviasiCount = 0;
                if (deltaGyro > 18.0f) deviasiCount++;
                if (fabsf(avgFeatures[1] - 0.5f * (activeUsers[bestUserIdx].means[0][1] + activeUsers[bestUserIdx].means[1][1])) > 15.0f) deviasiCount++;
                if (fabsf(avgFeatures[2] - 0.5f * (activeUsers[bestUserIdx].means[0][2] + activeUsers[bestUserIdx].means[1][2])) > 20.0f) deviasiCount++;
                if (fabsf(avgFeatures[3] - 0.5f * (activeUsers[bestUserIdx].means[0][3] + activeUsers[bestUserIdx].means[1][3])) > 12.0f) deviasiCount++;
                if (fabsf(avgFeatures[4] - 0.5f * (activeUsers[bestUserIdx].means[0][4] + activeUsers[bestUserIdx].means[1][4])) > 18.0f) deviasiCount++;

                // Gerbang Kinematika Fisik (Anti-Ayun Tangan Bebas - Calibrated)
                bool isHandSwing = (avgAxisDominance > 0.88f) || (avgNormJerk < 0.28f);
                isKinematicallyValid = (deviasiCount < 2) && (deltaGyro <= 22.0f) && !isHandSwing;

                // Gerbang Penempatan Celana Ketat (Anti-Saku Jaket / Torso - Calibrated)
                bool isTorsoJacket = (avgThighExcursion < 30.0f) || 
                                     (avgThighExcursion < 35.0f && avgAsym < 1.35f);
                isPantsPocketPlacement = !isTorsoJacket;

                if (bestConfidence >= CONFIDENCE_HIGH_THRESHOLD && hasCleanMargin && isKinematicallyValid && isPantsPocketPlacement) {
                    Serial.print(F("[AUTH] Autentikasi SAH untuk: "));
                    Serial.print(activeUsers[bestUserIdx].userName);
                    Serial.print(F(" (Skor: "));
                    Serial.print(bestConfidence);
                    Serial.print(F("%, Runner-up: "));
                    Serial.print(runnerUpConfidence);
                    if (isRunnerUpSameUser && foreignUserIdx >= 0) {
                        Serial.print(F("%, Foreign Runner-up: "));
                        Serial.print(maxForeignConfidence);
                    }
                    Serial.println(F("%)"));

                    char doorMsg[64];
                    snprintf(doorMsg, sizeof(doorMsg), "OPEN_DOOR:%s", activeUsers[bestUserIdx].userName);
                    ble.sendDoorCommand(doorMsg);
                } else if (!isKinematicallyValid) {
                    Serial.print(F("[AUTH VETO] Ditolak: Gerakan Ayun Tangan Bebas / Kinematika Abnormal (Jerk: "));
                    Serial.print(avgNormJerk, 3);
                    Serial.print(F(", AxisDom: "));
                    Serial.print(avgAxisDominance, 2);
                    Serial.print(F(", Deviasi: "));
                    Serial.print(deviasiCount);
                    Serial.print(F(" fitur, Gyro Delta: "));
                    Serial.print(deltaGyro, 1);
                    Serial.println(F(" deg/s)"));
                    ble.sendDoorCommand("ACCESS_DENIED");
                } else if (!isPantsPocketPlacement) {
                    Serial.print(F("[AUTH VETO] Ditolak: Penempatan Saku Jaket / Torso (Ayunan Paha: "));
                    Serial.print(avgThighExcursion, 1);
                    Serial.print(F(" deg, Asym: "));
                    Serial.print(avgAsym, 2);
                    Serial.print(F(", Dominansi Sumbu: "));
                    Serial.print(avgAxisDominance, 2);
                    Serial.print(F(", Crest: "));
                    Serial.print(avgCrestFactor, 2);
                    Serial.println(F(")"));
                    ble.sendDoorCommand("ACCESS_DENIED");
                } else if (bestConfidence >= CONFIDENCE_HIGH_THRESHOLD && !hasCleanMargin) {
                    Serial.print(F("[AUTH AMBIGU] Akses Ditolak: Skor bersaing ketat dengan profil lain"));
                    if (isRunnerUpSameUser && foreignUserIdx >= 0) {
                        Serial.print(F(" (Slot Foreign "));
                        Serial.print(foreignUserIdx);
                        Serial.print(F(" @ "));
                        Serial.print(maxForeignConfidence);
                        Serial.println(F("%)"));
                    } else {
                        Serial.print(F(" (Slot "));
                        Serial.print(runnerUpUserIdx);
                        Serial.print(F(" @ "));
                        Serial.print(runnerUpConfidence);
                        Serial.println(F("%)"));
                    }
                    ble.sendDoorCommand("ACCESS_DENIED");
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