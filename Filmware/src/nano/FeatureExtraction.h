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

    // Reset buffer saat memulai siklus jendela baru
    void resetBuffer() {
        bufferIndex = 0;
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

        // Bernilai true jika jendela sudah genap 300 sampel (3 detik)
        return (bufferIndex >= WINDOW_SIZE);
    }

    // Penapisan Zero-Velocity Update (ZUPT): Memisahkan jalan aktif vs berdiri diam
    bool evaluateZUPT() const {
        float totalEnergy = 0.0f;
        for (uint16_t i = 0; i < WINDOW_SIZE; ++i) {
            for (uint8_t j = 0; j < 3; ++j) {
                totalEnergy += (gyroBuffer[i][j] * gyroBuffer[i][j]);
            }
        }
        totalEnergy /= (float)WINDOW_SIZE;
        return (totalEnergy >= ZUPT_ENERGY_THRESHOLD);
    }

    // Ekstraksi 5 Fitur Statistik Domain Waktu dari magnitude energi resultan
    void computeFeatures(float extractedFeatures[NUM_FEATURES]) {
        // 1. Hitung magnitude sinyal 3D per timestamp: r = sqrt(gx^2 + gy^2 + gz^2)
        float magnitude[WINDOW_SIZE];
        for (uint16_t i = 0; i < WINDOW_SIZE; ++i) {
            float gx = gyroBuffer[i][0];
            float gy = gyroBuffer[i][1];
            float gz = gyroBuffer[i][2];
            magnitude[i] = sqrtf(gx * gx + gy * gy + gz * gz);
        }

        // Fitur 1: Rata-rata (Mean)
        float sum = 0.0f;
        for (uint16_t i = 0; i < WINDOW_SIZE; ++i) {
            sum += magnitude[i];
        }
        float mean = sum / (float)WINDOW_SIZE;

        // Akumulasi momen kedua, ketiga, dan keempat
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

        // Fitur 2 & 3: Variansi dan Standar Deviasi
        float variance = sumVar / (float)(WINDOW_SIZE - 1);
        float stdDev = sqrtf(variance);

        // Fitur 4: Kemiringan (Skewness)
        float denomSkew = powf(sumVar / (float)WINDOW_SIZE, 1.5f);
        float skewness = (denomSkew > EPSILON) ? ((sumSkew / (float)WINDOW_SIZE) / denomSkew) : 0.0f;

        // Fitur 5: Keruncingan (Kurtosis)
        float denomKurt = powf(sumVar / (float)WINDOW_SIZE, 2.0f);
        float kurtosis = (denomKurt > EPSILON) ? ((sumKurt / (float)WINDOW_SIZE) / denomKurt) : 0.0f;

        // Salin nilai ke array fitur
        extractedFeatures[0] = mean;
        extractedFeatures[1] = variance;
        extractedFeatures[2] = stdDev;
        extractedFeatures[3] = skewness;
        extractedFeatures[4] = kurtosis;
    }
};

#endif // FEATURE_EXTRACTION_H