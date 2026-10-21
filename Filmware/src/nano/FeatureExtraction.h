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

    // Buffer sirkular untuk 1 jendela data (giroskop 3 sumbu & magnitudo akselerasi dinamis skalar)
    float gyroBuffer[WINDOW_SIZE][3];
    float accMagBuffer[WINDOW_SIZE];
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
        memmove(&accMagBuffer[0], &accMagBuffer[step], remaining * sizeof(float));
        bufferIndex = remaining;
    }

    // Set nilai offset kemiringan hasil Online Calibration 5 detik awal
    void setOrientationOffsets(float roll, float pitch) {
        rollOffset = roll;
        pitchOffset = pitch;
    }

    // Memasukkan 1 sampel data mentah IMU (akselerometer & giroskop), menyaring noise via Kalman, dan menyimpan ke buffer
    bool addSample(float ax, float ay, float az, float gx, float gy, float gz) {
        // 1. Reduksi getaran kain/deadband
        gx = (fabs(gx) < GYRO_THRESHOLD) ? 0.0f : gx;
        gy = (fabs(gy) < GYRO_THRESHOLD) ? 0.0f : gy;
        gz = (fabs(gz) < GYRO_THRESHOLD) ? 0.0f : gz;

        // 2. Filter Kalman diskrit gyro
        float filteredX = kalmanGx.updateEstimate(gx);
        float filteredY = kalmanGy.updateEstimate(gy);
        float filteredZ = kalmanGz.updateEstimate(gz);

        // 3. Hitung magnitudo akselerasi skalar dan kurangi komponen gravitasi bumi 1.0g (100% Orientation Invariant)
        float accMag = sqrtf(ax * ax + ay * ay + az * az);
        float dynAcc = fabsf(accMag - 1.0f); // Intensitas getaran/hentakan translasi

        // 4. Simpan ke buffer
        if (bufferIndex < WINDOW_SIZE) {
            gyroBuffer[bufferIndex][0] = filteredX;
            gyroBuffer[bufferIndex][1] = filteredY;
            gyroBuffer[bufferIndex][2] = filteredZ;
            accMagBuffer[bufferIndex] = dynAcc;
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

    // Ekstraksi 5 Fitur Biometrik Ortogonal & Invarian Orientasi
    void computeFeatures(float extractedFeatures[NUM_FEATURES]) {
        // 1. Hitung magnitude sinyal 3D gyro per timestamp: r = sqrt(gx^2 + gy^2 + gz^2)
        float rawMag[WINDOW_SIZE];
        float sum = 0.0f;
        for (uint16_t i = 0; i < WINDOW_SIZE; ++i) {
            float gx = gyroBuffer[i][0];
            float gy = gyroBuffer[i][1];
            float gz = gyroBuffer[i][2];
            rawMag[i] = sqrtf(gx * gx + gy * gy + gz * gz);
            sum += rawMag[i];
        }

        // Fitur 0: Rerata Kecepatan Sudut Ayunan Paha (Mean Gyro, deg/s)
        float mean = sum / (float)WINDOW_SIZE;

        // 2. Akumulasi momen variansi tenaga langkah
        float sumVar = 0.0f;
        for (uint16_t i = 0; i < WINDOW_SIZE; ++i) {
            float diff = rawMag[i] - mean;
            sumVar += (diff * diff);
        }

        // Fitur 1: Variansi Sinyal Gyro (deg^2/s^2)
        float variance = sumVar / (float)(WINDOW_SIZE - 1);

        // Fitur 2 & Fitur 3: Keteraturan Irama Langkah & Periode Langkah Sejati (Stride Lag / k_peak)
        // Dihitung dari autokorelasi sinyal fisik kontinu asli (rentang lag k = 35 s.d. 115 sampel = 0.35s s.d. 1.15s)
        float maxAutocorr = 0.0f;
        uint8_t bestLag = 55; // Nilai default tengah
        if (sumVar > EPSILON) {
            for (uint8_t k = 35; k <= 115; ++k) {
                float sumCross = 0.0f;
                for (uint16_t i = 0; i < WINDOW_SIZE - k; ++i) {
                    sumCross += ((rawMag[i] - mean) * (rawMag[i + k] - mean));
                }
                // Koreksi rasio overlap (WINDOW_SIZE / (WINDOW_SIZE - k))
                float r = (sumCross * ((float)WINDOW_SIZE / (float)(WINDOW_SIZE - k))) / sumVar;
                if (r > maxAutocorr) {
                    maxAutocorr = r;
                    bestLag = k;
                }
            }
        }
        if (maxAutocorr < 0.0f) maxAutocorr = 0.0f;
        if (maxAutocorr > 1.0f) maxAutocorr = 1.0f;
        
        // Fitur 2: Konsistensi Irama Langkah (0.0% s.d. 100.0%)
        float cadenceRegularity = maxAutocorr * 100.0f;

        // Fitur 3: Periode Langkah Sejati (Dominant Stride Period, satuan: jumlah sampel @ 10ms)
        // Sidik jari biometrik anatomi (panjang kaki / ritme motorik) yang membedakan antar pengguna
        float stridePeriod = (float)bestLag;

        // Fitur 4: Intensitas Hentakan Akselerometer Dinamik (Heel-Strike Ground Impact RMS, skala %g)
        // Menolak secara mutlak saku jaket dan ayunan tangan karena hentakan benturan tanah di dada/tangan mendekati nol
        float sumDynAcc2 = 0.0f;
        for (uint16_t i = 0; i < WINDOW_SIZE; ++i) {
            sumDynAcc2 += (accMagBuffer[i] * accMagBuffer[i]);
        }
        float impactRms = sqrtf(sumDynAcc2 / (float)WINDOW_SIZE);
        float heelStrikeImpact = impactRms * 100.0f; // Skala 0 s.d. 100 %g (saku celana: ~35-80, saku jaket: <15)

        // Salin ke array 5 fitur biometrik
        extractedFeatures[0] = mean;
        extractedFeatures[1] = variance;
        extractedFeatures[2] = cadenceRegularity; // Konsistensi Irama (%)
        extractedFeatures[3] = stridePeriod;      // Periode Langkah (sampel)
        extractedFeatures[4] = heelStrikeImpact;  // Hentakan Kaki (%g)
    }
};

#endif // FEATURE_EXTRACTION_H