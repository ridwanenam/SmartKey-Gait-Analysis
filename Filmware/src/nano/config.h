#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>

// ==========================================
// 1. PARAMETER HARDWARE & SAMPLING KINEMATIKA
// ==========================================
constexpr float IMU_SAMPLE_RATE_HZ   = 100.0f;                       // Frekuensi sampling sensor IMU
constexpr uint32_t IMU_SAMPLE_INTERVAL_MS = 10;                     // 100 Hz = 10 ms
constexpr uint16_t WINDOW_SIZE       = 300;                          // 3 detik x 100 Hz (Spesifikasi 3)
constexpr uint8_t  TARGET_WINDOWS    = 10;                           // Syarat kuota 10 jendela valid
constexpr uint32_t CALIBRATION_DURATION_MS = 5000;                  // 5 detik Online Calibration awal

// ==========================================
// 2. PARAMETER ZUPT & PENAPISAN STATISTIK
// ==========================================
constexpr float GYRO_THRESHOLD       = 0.005f;                       // Deadband getaran kain saku
constexpr float ZUPT_ENERGY_THRESHOLD = 0.85f;                       // Ambang batas pemisah gerak vs diam
constexpr float EPSILON              = 1e-6f;                        // Mencegah error pembagian nol/log(0)

// ==========================================
// 3. PARAMETER ARSITEKTUR GHMM & ADAPTIF
// ==========================================
constexpr uint8_t MAX_USERS          = 5;                            // Kapasitas memori untuk 5 pengguna
constexpr uint8_t NUM_STATES         = 5;                            // Jumlah hidden states siklus melangkah
constexpr uint8_t NUM_FEATURES       = 5;                            // 5 Fitur: Mean, Var, Std, Skew, Kurt
constexpr float   EMA_ALPHA          = 0.15f;                        // Smoothing factor pembaruan inkremental
constexpr float   BASE_LOG_THRESHOLD = -150.0f;                      // Ambang batas dasar log-likelihood
constexpr float   CONFIDENCE_HIGH_THRESHOLD = 80.0f;                 // Ambang batas CIR minimal lolos akses (%)

// ==========================================
// 4. PROTOKOL BLUETOOTH LOW ENERGY (BLE)
// ==========================================
#define BLE_DEVICE_NAME             "SmartKey_Wearable"
#define BLE_SERVICE_UUID            "19B10000-E8F2-537E-4F6C-D104768A1214"
#define BLE_CHAR_RX_CMD_UUID        "19B10001-E8F2-537E-4F6C-D104768A1214"  // Terima trigger dari Mobile App
#define BLE_CHAR_TX_TELEMETRY_UUID  "19B10002-E8F2-537E-4F6C-D104768A1214"  // Kirim data metrik ke Mobile App
#define BLE_CHAR_TX_DOOR_UUID       "19B10003-E8F2-537E-4F6C-D104768A1214"  // Kirim perintah akses ke ESP32

// ==========================================
// 5. ENUMERASI STATE MACHINE PROGRAM (FSM)
// ==========================================
enum SystemState {
    STATE_IDLE,
    STATE_CALIBRATING,
    STATE_TRAINING,
    STATE_AUTHENTICATING
};

// ==========================================
// 6. STRUKTUR DATA MODEL PENGGUNA (DYNAMIC GHMM)
// Wadah non-statis yang disimpan ke Flash
// ==========================================
struct UserModel {
    bool isRegistered;
    char userName[16];
    float startProb[NUM_STATES];
    float transMat[NUM_STATES][NUM_STATES];
    float means[NUM_STATES][NUM_FEATURES];
    float covars[NUM_STATES][NUM_FEATURES];
};

// ==========================================
// 7. STRUKTUR DATA TELEMETRI REAL-TIME
// Disalurkan via BLE untuk Live Debugging & CSV HP
// ==========================================
struct __attribute__((packed)) TelemetryData {
    uint8_t  windowIndex;       // Indeks jendela berjalan (1/10 s.d. 10/10)
    uint8_t  isZUPTValid;       // 1 = Gerak melangkah valid, 0 = Diam/Noise
    float    confidenceScore;   // Skor keyakinan persentase (0.0% - 100.0%)
    float    logLikelihood;     // Akumulasi log-likelihood Forward GHMM
    float    features[5];       // Nilai aktual: Mean, Var, Std, Skew, Kurt
    float    adaptiveThreshold; // Nilai ambang dinamis dari Peak Tracking
    float    emaDelta;          // Besaran koreksi pembaruan inkremental
};

#endif // CONFIG_H