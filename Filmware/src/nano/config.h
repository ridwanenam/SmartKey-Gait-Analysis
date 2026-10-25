#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>

// ==========================================
// 1. PARAMETER HARDWARE & SAMPLING KINEMATIKA
// ==========================================
constexpr float IMU_SAMPLE_RATE_HZ   = 100.0f;                       // Frekuensi sampling sensor IMU
constexpr uint32_t IMU_SAMPLE_INTERVAL_MS = 10;                     // 100 Hz = 10 ms
constexpr uint16_t WINDOW_SIZE       = 150;                          // 1.5 detik x 100 Hz (Panjang Jendela)
constexpr uint16_t WINDOW_STEP       = 75;                           // 50% Overlap (0.75 detik per pergeseran sliding window)
constexpr uint8_t  TARGET_WINDOWS    = 5;                            // Syarat kuota 5 jendela valid (~4.5 detik total)

// ==========================================
// 2. PARAMETER ZUPT & PENAPISAN STATISTIK
// ==========================================
constexpr float GYRO_THRESHOLD       = 0.005f;                       // Deadband getaran kain saku
constexpr float ZUPT_ENERGY_THRESHOLD = 0.85f;                       // Ambang batas pemisah gerak vs diam
constexpr float EPSILON              = 1e-6f;                        // Mencegah error pembagian nol/log(0)

// ==========================================
// 3. PARAMETER ARSITEKTUR GHMM & ADAPTIF
// ==========================================
constexpr uint8_t MAX_USERS          = 6;                            // Kapasitas memori untuk 6 pengguna
constexpr uint8_t NUM_STATES         = 2;                            // Jumlah hidden states siklus melangkah (Dual-Phase: Kaki Kanan vs Kiri)
constexpr uint8_t NUM_FEATURES       = 5;                            // 5 Fitur: Mean, Var, Stride Regularity, Stride Period (k_peak), Heel-Strike Impact
constexpr float   EMA_ALPHA          = 0.10f;                        // Smoothing factor pembaruan inkremental konservatif
constexpr float   BASE_LOG_THRESHOLD = -20.0f;                       // Ambang batas dasar log-likelihood ternormalisasi (Length-Normalized LL)
constexpr float   CONFIDENCE_HIGH_THRESHOLD = 80.0f;                 // Ambang batas CIR minimal lolos akses (%)
constexpr float   SEPARATION_MARGIN_MIN      = 3.0f;                 // Ambang batas margin separasi minimal antar profil pemilik berbeda (%)

// ==========================================
// 4. PROTOKOL BLUETOOTH LOW ENERGY (BLE)
// ==========================================
#define BLE_DEVICE_NAME             "SmartKey_Wearable"
#define BLE_SERVICE_UUID            "19B10000-E8F2-537E-4F6C-D104768A1214"
#define BLE_CHAR_RX_CMD_UUID        "19B10001-E8F2-537E-4F6C-D104768A1214"  // Terima trigger dari Mobile App
#define BLE_CHAR_TX_TELEMETRY_UUID  "19B10002-E8F2-537E-4F6C-D104768A1214"  // Kirim data metrik ke Mobile App
#define BLE_CHAR_TX_DOOR_UUID       "19B10003-E8F2-537E-4F6C-D104768A1214"  // Kirim perintah akses ke ESP32
#define BLE_CHAR_TX_LIVE_UUID       "19B10004-E8F2-537E-4F6C-D104768A1214"  // Kirim live waveform sample 20 Hz (Pure Real Data)

// ==========================================
// 5. ENUMERASI STATE MACHINE PROGRAM (FSM)
// ==========================================
enum SystemState {
    STATE_IDLE,
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
    float baselineLogProb; // Rerata Log-Likelihood baseline hasil self-evaluasi saat training
};

// ==========================================
// 7. STRUKTUR DATA TELEMETRI REAL-TIME
// Disalurkan via BLE untuk Live Debugging & CSV HP
// ==========================================
struct __attribute__((packed)) TelemetryData {
    uint8_t  windowIndex;       // Indeks jendela berjalan (1/5 s.d. 5/5)
    uint8_t  isZUPTValid;       // 1 = Gerak melangkah valid, 0 = Diam/Noise
    float    confidenceScore;   // Skor keyakinan persentase (0.0% - 100.0%)
    float    logLikelihood;     // Akumulasi log-likelihood Forward GHMM
    float    features[5];       // Nilai aktual: Mean, Var, Std, Skew, Kurt
    float    adaptiveThreshold; // Nilai ambang dinamis dari Peak Tracking
    float    emaDelta;          // Besaran koreksi pembaruan inkremental
};

// ==========================================
// 8. STRUKTUR DATA LIVE SAMPLE 20 HZ
// Disalurkan via BLE untuk Osiloskop Real-Time Fisik
// ==========================================
struct __attribute__((packed)) LiveSampleData {
    float    liveVal;    // Akselerasi dinamis real-time (g)
    float    energy;     // Energi kinematika sesaat
    uint8_t  isMoving;   // 1 = Gerak aktif (ZUPT live), 0 = Diam/Statis
};

#endif // CONFIG_H