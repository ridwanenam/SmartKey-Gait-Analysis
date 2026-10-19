#ifndef FEATURE_EXTRACTION_H
#define FEATURE_EXTRACTION_H

#include <Arduino.h>
#include <math.h>
#include <SimpleKalmanFilter.h>
#include "Config.h"

class FeatureExtraction {
private:
    // Tiga instance Kalman Filter diskrit untuk sumbu X, Y, Z giroskop
    SimpleKalmanFilter kalmanGx;
    SimpleKalmanFilter kalmanGy;
    SimpleKalmanFilter kalmanGz;

    // Buffer sirkular untuk 1 jendela data (300 sampel x 3 sumbu)
    float gyroBuffer[WINDOW_SIZE][3];
    uint16_t bufferIndex;

    // Komponen offset dynamic online calibration
    float rollOffset;
    float pitchOffset;

public:
    FeatureExtraction() 
        : kalmanGx(0.001f, 0.002f, 0.001f),
          kalmanGy(0.001f, 0.002f, 0.001f),
          kalmanGz(0.001f, 0.002f, 0.001f),
          bufferIndex(0),
          rollOffset(0.0f),
          pitchOffset(0.0f) {}

    // Reset buffer total (misal saat berhenti melangkah / ZUPT diam)
    void resetBuffer() {
        bufferIndex = 0;
    }

    // Geser buffer secara bertahap (Sliding Window dengan 50% Overlap)
    void slideBuffer(uint16_t step = WINDOW_STEP) {
        if (step >= WINDOW_SIZE) {
            bufferIndex = 0;
            return;
        }
        uint16_t remaining = WINDOW_SIZE - step;
        memmove(&gyroBuffer[0][0], &gyroBuffer[step][0], remaining * 3 * sizeof(float));
        bufferIndex = remaining;
    }

    // Set nilai offset kemiringan hasil Online Calibration 5 detik awal
    void setOrientationOffsets(float roll, float pitch) {
        rollOffset = roll;
        pitchOffset = pitch;
    }

    // Memasukkan 1 sampel data mentah gyro, menyaring noise via Kalman, dan menyimpan ke buffer
    bool addSample(float gx, float gy, float gz) {
        // 1. Reduksi getaran kain/deadband
        gx = (fabs(gx) < GYRO_THRESHOLD) ? 0.0f : gx;
        gy = (fabs(gy) < GYRO_THRESHOLD) ? 0.0f : gy;
        gz = (fabs(gz) < GYRO_THRESHOLD) ? 0.0f : gz;

        // 2. Filter Kalman diskrit
        float filteredX = kalmanGx.updateEstimate(gx);
        float filteredY = kalmanGy.updateEstimate(gy);
        float filteredZ = kalmanGz.updateEstimate(gz);

        // 3. Simpan ke buffer
        if (bufferIndex < WINDOW_SIZE) {
            gyroBuffer[bufferIndex][0] = filteredX;
            gyroBuffer[bufferIndex][1] = filteredY;
            gyroBuffer[bufferIndex][2] = filteredZ;
            bufferIndex++;
        }

        // Bernilai true jika jendela sudah genap WINDOW_SIZE sampel (1.5 detik)
        return (bufferIndex >= WINDOW_SIZE);
    }

    // Penapisan Zero-Velocity Update (ZUPT) & Morfologi Hentakan Langkah (Gait Jerk Discriminator)
    bool evaluateZUPT() const {
        float totalEnergy = 0.0f;
        for (uint16_t i = 0; i < WINDOW_SIZE; ++i) {
            for (uint8_t j = 0; j < 3; ++j) {
                totalEnergy += (gyroBuffer[i][j] * gyroBuffer[i][j]);
            }
        }
        totalEnergy /= (float)WINDOW_SIZE;
        if (totalEnergy < ZUPT_ENERGY_THRESHOLD) {
            return false; // Diam / statis
        }

        // Hitung energi sentakan (jerk / deselerasi sesaat hentakan tumit ke tanah)
        float jerkEnergy = 0.0f;
        for (uint16_t i = 1; i < WINDOW_SIZE; ++i) {
            for (uint8_t j = 0; j < 3; ++j) {
                float diff = gyroBuffer[i][j] - gyroBuffer[i - 1][j];
                jerkEnergy += (diff * diff);
            }
        }
        jerkEnergy /= (float)(WINDOW_SIZE - 1);

        // Langkah kaki sejati di saku menghasilkan sentakan saat hentakan tumit (jerkEnergy >= 4.5)
        // Ayunan tangan bebas di udara bersifat mulus/sinusoidal murni (jerkEnergy < 4.5)
        if (jerkEnergy < 4.5f) {
            Serial.println(F("[ZUPT] Gerak Sinusoidal Mulus / Ayunan Tangan Terdeteksi -> Mengabaikan Jendela"));
            return false;
        }

        return true;
    }

    // Ekstraksi 5 Fitur Statistik Domain Waktu dengan Penyelarasan Fase Lembah (Heel-Strike / Valley Alignment)
    void computeFeatures(float extractedFeatures[NUM_FEATURES]) {
        // 1. Hitung magnitude sinyal 3D per timestamp: r = sqrt(gx^2 + gy^2 + gz^2)
        float rawMag[WINDOW_SIZE];
        for (uint16_t i = 0; i < WINDOW_SIZE; ++i) {
            float gx = gyroBuffer[i][0];
            float gy = gyroBuffer[i][1];
            float gz = gyroBuffer[i][2];
            rawMag[i] = sqrtf(gx * gx + gy * gy + gz * gz);
        }

        // 2. Deteksi Titik Lembah Awal (Heel-Strike / Valley Phase Alignment)
        // Cari lembah lokal terendah pada sepertiga awal jendela (50 sampel awal)
        uint16_t valleyIdx = 0;
        float minValleyVal = 999.0f;
        for (uint16_t i = 2; i < 50 && i < WINDOW_SIZE - 2; ++i) {
            if (rawMag[i] <= rawMag[i - 1] && rawMag[i] <= rawMag[i + 1] && rawMag[i] <= rawMag[i - 2]) {
                if (rawMag[i] < minValleyVal) {
                    minValleyVal = rawMag[i];
                    valleyIdx = i;
                }
            }
        }

        // 3. Salin data dengan rotasi fase sirkular agar awal jendela selalu sejajar dengan fase lembah hentakan langkah
        float magnitude[WINDOW_SIZE];
        for (uint16_t i = 0; i < WINDOW_SIZE; ++i) {
            uint16_t srcIdx = (valleyIdx + i) % WINDOW_SIZE;
            magnitude[i] = rawMag[srcIdx];
        }

        // 4. Hitung Fitur 1: Rata-rata (Mean)
        float sum = 0.0f;
        for (uint16_t i = 0; i < WINDOW_SIZE; ++i) {
            sum += magnitude[i];
        }
        float mean = sum / (float)WINDOW_SIZE;

        // 5. Akumulasi momen kedua, ketiga, dan keempat
        float sumVar = 0.0f;
        float sumSkew = 0.0f;
        float sumKurt = 0.0f;

        for (uint16_t i = 0; i < WINDOW_SIZE; ++i) {
            float diff = magnitude[i] - mean;
            float diff2 = diff * diff;
            float diff3 = diff2 * diff;
            float diff4 = diff2 * diff2;

            sumVar += diff2;
            sumSkew += diff3;
            sumKurt += diff4;
        }

        // Fitur 2: Variansi Sinyal (Sebaran Tenaga Langkah)
        float variance = sumVar / (float)(WINDOW_SIZE - 1);

        // Fitur 3: Keteraturan Irama Langkah (Stride Periodicity / Cadence Regularity via Autocorrelation - Derawi et al., 2010)
        // Menggantikan StdDev yang redundan dengan mengukur korelasi diri sinyal pada rentang lag langkah manusia (35 s.d. 80 sampel = 0.35s s.d. 0.80s)
        float maxAutocorr = 0.0f;
        if (sumVar > EPSILON) {
            for (uint8_t k = 35; k <= 80; ++k) {
                float sumCross = 0.0f;
                for (uint16_t i = 0; i < WINDOW_SIZE - k; ++i) {
                    sumCross += ((magnitude[i] - mean) * (magnitude[i + k] - mean));
                }
                // Koreksi rasio overlap (WINDOW_SIZE / (WINDOW_SIZE - k))
                float r = (sumCross * ((float)WINDOW_SIZE / (float)(WINDOW_SIZE - k))) / sumVar;
                if (r > maxAutocorr) {
                    maxAutocorr = r;
                }
            }
        }
        if (maxAutocorr < 0.0f) maxAutocorr = 0.0f;
        if (maxAutocorr > 1.0f) maxAutocorr = 1.0f;
        float cadenceRegularity = maxAutocorr * 100.0f; // Skala persentase 0.0% s.d. 100.0% (Konsistensi Irama)

        // Fitur 4: Kemiringan (Skewness)
        float denomSkew = powf(sumVar / (float)WINDOW_SIZE, 1.5f);
        float skewness = (denomSkew > EPSILON) ? ((sumSkew / (float)WINDOW_SIZE) / denomSkew) : 0.0f;

        // Fitur 5: Keruncingan (Kurtosis)
        float denomKurt = powf(sumVar / (float)WINDOW_SIZE, 2.0f);
        float kurtosis = (denomKurt > EPSILON) ? ((sumKurt / (float)WINDOW_SIZE) / denomKurt) : 0.0f;

        // Salin nilai ke array fitur
        extractedFeatures[0] = mean;
        extractedFeatures[1] = variance;
        extractedFeatures[2] = cadenceRegularity; // Konsistensi Irama Langkah (menggantikan StdDev)
        extractedFeatures[3] = skewness;
        extractedFeatures[4] = kurtosis;
    }
};

#endif // FEATURE_EXTRACTION_H