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
GHMMClassifier   rawGhmm[MAX_USERS]; // Jalur bayangan Tanpa Kalman untuk mode komparasi 1x jalan
BLEHandler       ble;

// Variabel Status & Konfigurasi Runtime
bool kalmanTestMode = false; // Default OFF (mode normal); ON saat toggle Uji Kalman di Dev Mode
SystemState currentState = STATE_IDLE;
UserModel activeUsers[MAX_USERS];
uint8_t currentSlotTarget = 0;
char targetUserName[32] = "User_1";
uint8_t validWindowCounter = 0;
float trainingFeaturesBuffer[TARGET_WINDOWS][NUM_FEATURES];

// Penanda re-advertising aman non-blocking (bebas deadlock SPI)
volatile bool g_bleNeedsAdvertise = false;

// Variabel Penanda Waktu Non-Blocking (100 Hz = 10 ms) & Pemantau Glitch IMU
unsigned long previousSampleTime = 0;
constexpr uint16_t MAX_CONSECUTIVE_IMU_ERRORS = 30;  // ~300 ms error baca I2C beruntun -> abort sesi
constexpr uint32_t MAX_IMU_STALL_MS           = 450; // ~450 ms bus I2C macet tanpa update -> abort sesi
uint16_t consecutiveImuErrors = 0;
unsigned long sessionStartTimeMs = 0;
unsigned long lastAccValidMs = 0;
unsigned long lastGyroValidMs = 0;

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

    // 1. Polling Event Komunikasi BLE (Throttling 2 ms non-blocking untuk melindungi bus SPI Nina-W102 di semua state)
    unsigned long currentMillis = millis();
    static unsigned long lastBlePollTime = 0;
    if (currentMillis - lastBlePollTime >= 2) {
        lastBlePollTime = currentMillis;
        ble.poll();
        handleIncomingCommands();
    }

    // 2. Scheduler Pengambilan Data IMU pada 100 Hz (10 ms)
    if (currentMillis - previousSampleTime >= IMU_SAMPLE_INTERVAL_MS) {
        previousSampleTime = currentMillis;

        // Lapis 1 (Sample-and-Hold): Gunakan variabel sementara & validasi return + isfinite()
        // Jika I2C gagal sesaat (1-2 sampel), nilai valid terakhir dipertahankan tanpa meracuni pipeline
        static float ax = 0.0f, ay = 0.0f, az = 1.0f;
        static float gx = 0.0f, gy = 0.0f, gz = 0.0f;
        bool hadImuReadError = false;

        if (IMU.accelerationAvailable()) {
            float nax = 0.0f, nay = 0.0f, naz = 0.0f;
            if (IMU.readAcceleration(nax, nay, naz) == 1 &&
                isfinite(nax) && isfinite(nay) && isfinite(naz)) {
                ax = nax;
                ay = nay;
                az = naz;
                lastAccValidMs = currentMillis;
            } else {
                hadImuReadError = true;
            }
        }
        if (IMU.gyroscopeAvailable()) {
            float ngx = 0.0f, ngy = 0.0f, ngz = 0.0f;
            if (IMU.readGyroscope(ngx, ngy, ngz) == 1 &&
                isfinite(ngx) && isfinite(ngy) && isfinite(ngz)) {
                gx = ngx;
                gy = ngy;
                gz = ngz;
                lastGyroValidMs = currentMillis;
            } else {
                hadImuReadError = true;
            }
        }

        // Lapis 2: Pantau glitch IMU beruntun / macet saat Registrasi maupun Autentikasi aktif
        if (currentState == STATE_TRAINING || currentState == STATE_AUTHENTICATING) {
            if (hadImuReadError) {
                consecutiveImuErrors++;
            } else {
                consecutiveImuErrors = 0;
            }

            bool isStalled = (currentMillis > sessionStartTimeMs) &&
                             (currentMillis - sessionStartTimeMs > MAX_IMU_STALL_MS) &&
                             ((currentMillis > lastAccValidMs && currentMillis - lastAccValidMs > MAX_IMU_STALL_MS) ||
                              (currentMillis > lastGyroValidMs && currentMillis - lastGyroValidMs > MAX_IMU_STALL_MS));

            if (consecutiveImuErrors >= MAX_CONSECUTIVE_IMU_ERRORS || isStalled) {
                const char *phaseStr = (currentState == STATE_TRAINING) ? "TRAINING" : "AUTH";
                Serial.print(F("[ERR SENSOR] Glitch IMU beruntun (err="));
                Serial.print(consecutiveImuErrors);
                Serial.print(F(") -> Membatalkan sesi "));
                Serial.println(phaseStr);

                currentState = STATE_IDLE;
                validWindowCounter = 0;
                consecutiveImuErrors = 0;
                featureExtractor.resetSession();

                // Coba pulihkan bus IMU setelah pembatalan aman
                IMU.begin();

                char glitchMsg[32];
                snprintf(glitchMsg, sizeof(glitchMsg), "SENSOR_GLITCH:%s", phaseStr);
                ble.sendDoorCommand(glitchMsg);
                return;
            }
        } else {
            consecutiveImuErrors = 0;
        }

        // 4. Eksekusi Finite State Machine (jalankan sebelum live sample agar nilai Kalman terbaru tersedia)
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

        // 3. Streaming Gelombang Sensor Fisik Nyata (20 Hz / tiap 50 ms)
        static unsigned long lastLiveSampleTime = 0;
        if (currentMillis - lastLiveSampleTime >= 50) {
            lastLiveSampleTime = currentMillis;
            if (ble.isConnected() && (currentState == STATE_AUTHENTICATING || currentState == STATE_TRAINING)) {
                // Hitung magnitudo akselerasi dan hilangkan komponen gravitasi bumi 1.0g
                float accMag = sqrtf(ax * ax + ay * ay + az * az);
                float dynAcc = accMag - 1.0f; // 0.0g saat diam

                // Energi rotasi giroskop & pasangan Raw vs Kalman terbaru
                float gyroEnergy = (gx * gx + gy * gy + gz * gz);
                float rawMagPair = 0.0f, kalmanMagPair = 0.0f;
                featureExtractor.getLatestGyroPair(rawMagPair, kalmanMagPair);
                if (rawMagPair <= 0.0f && gyroEnergy > 0.0f) {
                    rawMagPair = sqrtf(gyroEnergy);
                }

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
                liveData.rawGyroMag = rawMagPair;
                liveData.kalmanGyroMag = kalmanMagPair;
                ble.sendLiveSample(liveData);
            }
        }
    }

    // 5. Jeda hemat daya ringan saat Idle
    if (currentState == STATE_IDLE) {
        delay(1);
    }
}

// Memuat ulang profil terdaftar dari Flash ke RAM
void reloadUsersFromFlash() {
    StorageManager::loadAll(activeUsers);
    for (uint8_t i = 0; i < MAX_USERS; ++i) {
        if (!activeUsers[i].isRegistered) {
            memset(&activeUsers[i], 0, sizeof(UserModel));
            ghmm[i].resetInference();
            rawGhmm[i].resetInference();
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
                consecutiveImuErrors = 0;
                unsigned long nowMs = millis();
                sessionStartTimeMs = nowMs;
                lastAccValidMs = nowMs;
                lastGyroValidMs = nowMs;
                featureExtractor.resetSession();
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
            featureExtractor.resetSession();
            for (uint8_t i = 0; i < MAX_USERS; ++i) {
                ghmm[i].resetInference();
                rawGhmm[i].resetInference();
            }
            validWindowCounter = 0;
            consecutiveImuErrors = 0;
            unsigned long nowMs = millis();
            sessionStartTimeMs = nowMs;
            lastAccValidMs = nowMs;
            lastGyroValidMs = nowMs;
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
            featureExtractor.resetSession();
            validWindowCounter = 0;
            consecutiveImuErrors = 0;
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
                    rawGhmm[i].resetInference();
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
                    rawGhmm[slotToDelete].resetInference();
                    StorageManager::saveAll(activeUsers);
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
                        bool saveOk = StorageManager::saveAll(activeUsers);
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
        // Toggle Mode Uji Komparasi Dual-Buffer Kalman dari Mobile App Dev Mode
        else if (strcmp(cmd, "KALMAN_TEST:1") == 0) {
            kalmanTestMode = true;
            Serial.println(F("[TEST] Mode Uji Komparasi Dual-Buffer Kalman: AKTIF"));
        }
        else if (strcmp(cmd, "KALMAN_TEST:0") == 0) {
            kalmanTestMode = false;
            Serial.println(F("[TEST] Mode Uji Komparasi Dual-Buffer Kalman: NONAKTIF"));
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
                bool saveOk = StorageManager::saveAll(activeUsers);
                if (!saveOk) {
                    Serial.println(F("[STORAGE ERROR] Gagal menulis ke Flash! Mengulang saveAll..."));
                    saveOk = StorageManager::saveAll(activeUsers);
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

// Helper penalti proporsional linier untuk batas bawah (nilai < safeMin) dan batas atas (nilai > safeMax)
static inline float rampPenaltyLower(float val, float safeMin, float severeMin, float maxPenalty) {
    if (val >= safeMin) return 0.0f;
    if (val <= severeMin) return maxPenalty;
    return ((safeMin - val) / (safeMin - severeMin)) * maxPenalty;
}

static inline float rampPenaltyUpper(float val, float safeMax, float severeMax, float maxPenalty) {
    if (val <= safeMax) return 0.0f;
    if (val >= severeMax) return maxPenalty;
    return ((val - safeMax) / (severeMax - safeMax)) * maxPenalty;
}

struct PhysicalGateResult {
    float factor;
    float pJerk;
    float pExcursion;
    float pAxis;
    float pAsym;
    float pDeviasi;
    uint8_t deviasiCount;
    float deltaGyro;
};

// Evaluasi 5 gerbang kinematika fisik secara proporsional & sadar konteks model pemilik
static PhysicalGateResult evaluatePhysicalGates(
    const UserModel &model,
    const float avgFeatures[NUM_FEATURES],
    float avgNormJerk,
    float avgAsym,
    float avgThighExcursion,
    float avgCrestFactor,
    float avgAxisDominance
) {
    PhysicalGateResult res;
    res.deviasiCount = 0;

    float modelAvgGyro = 0.5f * (model.means[0][0] + model.means[1][0]);
    res.deltaGyro = fabsf(avgFeatures[0] - modelAvgGyro);

    if (res.deltaGyro > 18.0f) res.deviasiCount++;
    if (fabsf(avgFeatures[1] - 0.5f * (model.means[0][1] + model.means[1][1])) > 15.0f) res.deviasiCount++;
    if (fabsf(avgFeatures[2] - 0.5f * (model.means[0][2] + model.means[1][2])) > 20.0f) res.deviasiCount++;
    if (fabsf(avgFeatures[3] - 0.5f * (model.means[0][3] + model.means[1][3])) > 12.0f) res.deviasiCount++;
    if (fabsf(avgFeatures[4] - 0.5f * (model.means[0][4] + model.means[1][4])) > 18.0f) res.deviasiCount++;

    // 1. Gerbang NormJerk + Crest Factor (deteksi hentakan kaki vs ayunan mulus)
    res.pJerk = rampPenaltyLower(avgNormJerk, 0.27f, 0.17f, 0.45f);
    if (avgNormJerk < 0.27f && avgCrestFactor < 2.10f) {
        res.pJerk = fminf(0.55f, res.pJerk + 0.10f);
    }

    // 2. Gerbang ThighExcursion (speed-aware & impact-aware untuk profil pelan/halus vs saku jaket)
    float excSafe = (modelAvgGyro < 45.0f || (avgCrestFactor >= 3.0f && avgNormJerk >= 0.35f)) ? 24.0f : 28.0f;
    res.pExcursion = rampPenaltyLower(avgThighExcursion, excSafe, 16.0f, 0.45f);

    // 3. Gerbang AxisDominance (pendulum 1 sumbu ekstrem vs gerak paha 3D)
    res.pAxis = rampPenaltyUpper(avgAxisDominance, 0.85f, 0.95f, 0.45f);

    // 4. Gerbang Swing-Stance Asymmetry (asimetri langkah vs ayunan simetris torso/tangan)
    res.pAsym = rampPenaltyLower(avgAsym, 1.32f, 1.12f, 0.30f);

    // 5. Gerbang Deviasi 5 Fitur & DeltaGyro (penalti lembut, pelengkap jarak Mahalanobis GHMM)
    float pDevCount = 0.0f;
    if (res.deviasiCount == 2) pDevCount = 0.10f;
    else if (res.deviasiCount == 3) pDevCount = 0.22f;
    else if (res.deviasiCount >= 4) pDevCount = 0.35f;
    float pDeltaGyro = rampPenaltyUpper(res.deltaGyro, 22.0f, 38.0f, 0.25f);
    res.pDeviasi = 1.0f - (1.0f - pDevCount) * (1.0f - pDeltaGyro);

    res.factor = (1.0f - res.pJerk) *
                 (1.0f - res.pExcursion) *
                 (1.0f - res.pAxis) *
                 (1.0f - res.pAsym) *
                 (1.0f - res.pDeviasi);
    return res;
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

        // Akumulator komparasi Dual-Buffer Kalman (aktif saat kalmanTestMode == true)
        static float rawFeaturesSum[NUM_FEATURES] = {0};
        static float kRawStdSum = 0.0f;
        static float kFiltStdSum = 0.0f;
        static float kJerkRedSum = 0.0f;
        static float kRmseSum = 0.0f;
        static float kLatSum = 0.0f;
        int rawBestUserIdx = -1;
        float rawBestConfidence = -1.0f;
        float rawBestLogProb = -999.0f;

        // Variabel evaluasi gerbang fisik sesi
        PhysicalGateResult bestGateResult = {1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0, 0.0f};
        float avgFeatures[NUM_FEATURES] = {0};
        float avgThighExcursion = 0.0f;
        float avgCrestFactor = 0.0f;
        float avgAxisDominance = 0.0f;
        float avgNormJerk = 0.0f;
        float avgAsym = 0.0f;
        float deltaGyro = 0.0f;

        if (isWalking) {
            float currentFeatures[NUM_FEATURES];
            featureExtractor.computeFeatures(currentFeatures);

            for (uint8_t d = 0; d < NUM_FEATURES; ++d) {
                telem.features[d] = currentFeatures[d];
            }

            validWindowCounter++;
            telem.windowIndex = validWindowCounter;

            // Inisialisasi atau re-anchor akumulator pada jendela ke-1 dan jendela ke-2 (fase steady-state)
            if (validWindowCounter == 1 || validWindowCounter == 2) {
                for (uint8_t d = 0; d < NUM_FEATURES; ++d) {
                    sessionFeaturesSum[d] = 0.0f;
                    rawFeaturesSum[d] = 0.0f;
                }
                sessionThighExcursionSum = 0.0f;
                sessionCrestFactorSum = 0.0f;
                sessionAxisDominanceSum = 0.0f;
                sessionNormJerkSum = 0.0f;
                sessionAsymSum = 0.0f;
                kRawStdSum = 0.0f;
                kFiltStdSum = 0.0f;
                kJerkRedSum = 0.0f;
                kRmseSum = 0.0f;
                kLatSum = 0.0f;
            }

            for (uint8_t d = 0; d < NUM_FEATURES; ++d) {
                sessionFeaturesSum[d] += currentFeatures[d];
            }
            sessionThighExcursionSum += featureExtractor.computeThighExcursion();
            sessionCrestFactorSum += featureExtractor.computeImpactCrestFactor();
            sessionAxisDominanceSum += featureExtractor.computeAxisDominanceRatio();
            sessionNormJerkSum += featureExtractor.computeNormalizedJerkIndex();
            sessionAsymSum += featureExtractor.computeSwingStanceAsymmetry();

            // Jalur Pembanding Dual-Buffer Tanpa Kalman (hanya diproses saat Mode Uji Kalman aktif)
            if (kalmanTestMode) {
                float rawFeat[NUM_FEATURES];
                featureExtractor.computeRawFeatures(rawFeat);
                for (uint8_t d = 0; d < NUM_FEATURES; ++d) {
                    rawFeaturesSum[d] += rawFeat[d];
                }

                float wRawStd = 0.0f, wFiltStd = 0.0f, wJerkRed = 0.0f, wRmse = 0.0f;
                featureExtractor.computeKalmanMetrics(wRawStd, wFiltStd, wJerkRed, wRmse);
                kRawStdSum += wRawStd;
                kFiltStdSum += wFiltStd;
                kJerkRedSum += wJerkRed;
                kRmseSum += wRmse;
                kLatSum += featureExtractor.getLastKalmanLatencyUs();

                for (uint8_t i = 0; i < MAX_USERS; ++i) {
                    if (activeUsers[i].isRegistered) {
                        float rLogProb = rawGhmm[i].evaluateWindow(activeUsers[i], rawFeat, validWindowCounter);
                        float rConf = rawGhmm[i].calculateConfidenceScore(rLogProb);
                        if (rConf > rawBestConfidence) {
                            rawBestConfidence = rConf;
                            rawBestLogProb = rLogProb;
                            rawBestUserIdx = i;
                        }
                    }
                }
            }

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

                // Pada jendela ke-5 (selesai), evaluasi gerbang kinematika fisik proporsional per profil
                if (validWindowCounter >= TARGET_WINDOWS) {
                    float steadyDiv = (validWindowCounter >= 2) ? (float)(validWindowCounter - 1) : 1.0f;
                    for (uint8_t d = 0; d < NUM_FEATURES; ++d) {
                        avgFeatures[d] = sessionFeaturesSum[d] / steadyDiv;
                    }
                    avgThighExcursion = sessionThighExcursionSum / steadyDiv;
                    avgCrestFactor = sessionCrestFactorSum / steadyDiv;
                    avgAxisDominance = sessionAxisDominanceSum / steadyDiv;
                    avgNormJerk = sessionNormJerkSum / steadyDiv;
                    avgAsym = sessionAsymSum / steadyDiv;

                    float newBestConf = -1.0f;
                    int newBestIdx = bestUserIdx;
                    for (uint8_t i = 0; i < MAX_USERS; ++i) {
                        if (activeUsers[i].isRegistered) {
                            PhysicalGateResult gateRes = evaluatePhysicalGates(
                                activeUsers[i],
                                avgFeatures,
                                avgNormJerk,
                                avgAsym,
                                avgThighExcursion,
                                avgCrestFactor,
                                avgAxisDominance
                            );
                            userScores[i] *= gateRes.factor;
                            if (userScores[i] > newBestConf) {
                                newBestConf = userScores[i];
                                newBestIdx = i;
                                bestGateResult = gateRes;
                            }
                        }
                    }

                    if (newBestIdx >= 0) {
                        bestUserIdx = newBestIdx;
                        bestConfidence = newBestConf;
                        deltaGyro = bestGateResult.deltaGyro;
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

                // Jika Mode Uji Kalman aktif, kirim ringkasan komparasi Dual-Buffer (100 Hz penuh) ke Mobile App
                if (kalmanTestMode) {
                    float kDiv = (validWindowCounter >= 2) ? (float)(validWindowCounter - 1) : 1.0f;
                    float avgRawMean = rawFeaturesSum[0] / kDiv;
                    float avgRawGyroStd = rawFeaturesSum[1] / kDiv;
                    float avgRawStd100 = kRawStdSum / kDiv;
                    float avgFiltStd100 = kFiltStdSum / kDiv;
                    float avgJerkRed = kJerkRedSum / kDiv;
                    float avgRmse = kRmseSum / kDiv;
                    float avgLat = kLatSum / kDiv;
                    float rawConfFinal = (rawBestUserIdx >= 0) ? (rawBestConfidence * bestGateResult.factor) : 0.0f;

                    char kcmp1[64];
                    snprintf(kcmp1, sizeof(kcmp1), "KCMP1:%.1f|%.1f|%.2f|%.2f|%.1f|%.2f",
                        bestConfidence, rawConfFinal, bestLogProb, rawBestLogProb, avgJerkRed, avgRmse);
                    ble.sendDoorCommand(kcmp1);
                    delay(40);

                    char kcmp2[64];
                    snprintf(kcmp2, sizeof(kcmp2), "KCMP2:%.2f|%.2f|%.1f|%.1f|%.1f|%.1f|%.1f",
                        avgRawStd100, avgFiltStd100, avgLat, avgFeatures[0], avgRawMean, avgFeatures[1], avgRawGyroStd);
                    ble.sendDoorCommand(kcmp2);
                    delay(40);
                }

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
                Serial.print(deltaGyro, 1);
                Serial.print(F(" | GateFactor: "));
                Serial.println(bestGateResult.factor, 2);

                // Keputusan tunggal & selaras dengan skor akhir (penalti fisik sudah terintegrasi ke bestConfidence)
                if (bestConfidence >= CONFIDENCE_HIGH_THRESHOLD) {
                    Serial.print(F("[AUTH] Autentikasi SAH untuk: "));
                    Serial.print(activeUsers[bestUserIdx].userName);
                    Serial.print(F(" (Skor Akhir: "));
                    Serial.print(bestConfidence, 1);
                    Serial.println(F("%)"));

                    char doorMsg[64];
                    snprintf(doorMsg, sizeof(doorMsg), "OPEN_DOOR:%s", activeUsers[bestUserIdx].userName);
                    ble.sendDoorCommand(doorMsg);
                } else {
                    Serial.print(F("[AUTH] Akses Ditolak (Skor Akhir: "));
                    Serial.print(bestConfidence, 1);
                    Serial.print(F("%, Factor: "));
                    Serial.print(bestGateResult.factor, 2);
                    Serial.print(F(" | pJ="));
                    Serial.print(bestGateResult.pJerk, 2);
                    Serial.print(F(" pEx="));
                    Serial.print(bestGateResult.pExcursion, 2);
                    Serial.print(F(" pAx="));
                    Serial.print(bestGateResult.pAxis, 2);
                    Serial.print(F(" pAs="));
                    Serial.print(bestGateResult.pAsym, 2);
                    Serial.print(F(" pDev="));
                    Serial.print(bestGateResult.pDeviasi, 2);
                    Serial.println(F(")"));
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