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

    // Buffer sirkular untuk 1 jendela data (giroskop 3 sumbu, magnitudo akselerasi skalar, dan akselerasi mentah 3 sumbu)
    float gyroBuffer[WINDOW_SIZE][3];
    float accMagBuffer[WINDOW_SIZE];
    float accRawBuffer[WINDOW_SIZE][3];
    uint16_t bufferIndex;

public:
    FeatureExtraction() 
        : kalmanGx(0.001f, 0.002f, 0.001f),
          kalmanGy(0.001f, 0.002f, 0.001f),
          kalmanGz(0.001f, 0.002f, 0.001f),
          bufferIndex(0) {}

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
        memmove(&accRawBuffer[0][0], &accRawBuffer[step][0], remaining * 3 * sizeof(float));
        bufferIndex = remaining;
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
            accRawBuffer[bufferIndex][0] = ax;
            accRawBuffer[bufferIndex][1] = ay;
            accRawBuffer[bufferIndex][2] = az;
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

        // Fitur 1: Standar Deviasi Dinamis Sinyal Gyro (deg/s)
        // Menggantikan variansi mentah (deg^2/s^2) agar besaran fitur berada di rentang puluhan deg/s 
        // dan tidak memicu ledakan kuadrat jarak Mahalanobis di GHMM
        float variance = sumVar / (float)(WINDOW_SIZE - 1);
        float gyroStdDev = sqrtf(fmaxf(0.0f, variance));

        // Fitur 2 & Fitur 3: Keteraturan Irama Langkah (Cadence Regularity) & Periode Langkah Sejati (Lag k)
        // Menggunakan Koefisien Korelasi Pearson Zero-Mean per Slice pada rentang langkah tunggal (40 s.d. 75 sampel = 0.40s s.d. 0.75s per langkah)
        // Mencegah 'Octave Jumping' (lonjakan ke langkah ganda >100 sampel) dan mengeliminasi distorsi pergeseran DC offset
        float maxAutocorr = 0.0f;
        uint8_t bestLag = 55; // Nilai default ritme normal (~109 langkah/menit)
        if (sumVar > EPSILON) {
            for (uint8_t k = 40; k <= 75; ++k) {
                uint16_t m = WINDOW_SIZE - k;
                float sumX = 0.0f, sumY = 0.0f;
                for (uint16_t i = 0; i < m; ++i) {
                    sumX += rawMag[i];
                    sumY += rawMag[i + k];
                }
                float meanX = sumX / (float)m;
                float meanY = sumY / (float)m;
                float cross = 0.0f, varX = 0.0f, varY = 0.0f;
                for (uint16_t i = 0; i < m; ++i) {
                    float dx = rawMag[i] - meanX;
                    float dy = rawMag[i + k] - meanY;
                    cross += (dx * dy);
                    varX += (dx * dx);
                    varY += (dy * dy);
                }
                float denom = sqrtf(varX * varY);
                if (denom > EPSILON) {
                    float r = cross / denom;
                    if (r > maxAutocorr) {
                        maxAutocorr = r;
                        bestLag = k;
                    }
                }
            }
        }
        if (maxAutocorr < 0.0f) maxAutocorr = 0.0f;
        if (maxAutocorr > 1.0f) maxAutocorr = 1.0f;
        
        // Fitur 2: Konsistensi Irama Langkah (0.0% s.d. 100.0%)
        float cadenceRegularity = maxAutocorr * 100.0f;

        // Fitur 3: Periode Langkah Sejati (Dominant Step Period, rentang 40 s.d. 75 sampel @ 10ms = 400 s.d. 750 ms)
        float stridePeriod = (float)bestLag;

        // Fitur 4: Intensitas Hentakan Akselerometer Dinamik (Heel-Strike Ground Impact RMS, skala %g)
        // Menolak secara mutlak saku jaket dan ayunan tangan karena hentakan benturan tanah di dada/tangan mendekati nol
        float sumDynAcc2 = 0.0f;
        for (uint16_t i = 0; i < WINDOW_SIZE; ++i) {
            sumDynAcc2 += (accMagBuffer[i] * accMagBuffer[i]);
        }
        float impactRms = sqrtf(sumDynAcc2 / (float)WINDOW_SIZE);
        float heelStrikeImpact = impactRms * 100.0f; // Skala 0 s.d. 100 %g (saku celana: ~35-80, saku jaket: <15)

        // Salin ke array 5 fitur biometrik ortogonal
        extractedFeatures[0] = mean;
        extractedFeatures[1] = gyroStdDev;       // Simpangan Baku Ayunan (deg/s)
        extractedFeatures[2] = cadenceRegularity; // Konsistensi Irama (%)
        extractedFeatures[3] = stridePeriod;      // Periode Langkah (sampel)
        extractedFeatures[4] = heelStrikeImpact;  // Hentakan Kaki (%g)
    }

    // Mengestimasi rentang ayunan sudut gravitasi paha (Thigh Pendulum Excursion Angle, derajat)
    // Saku celana pada paha berayun maju-mundur sebesar 25 s.d. 45 derajat mengikuti langkah kaki
    // Saku jaket pada torso/dada tetap tegak dengan ekskursi < 14 derajat
    float computeThighExcursion() const {
        float sumAx = 0.0f, sumAy = 0.0f, sumAz = 0.0f;
        for (uint16_t i = 0; i < WINDOW_SIZE; ++i) {
            sumAx += accRawBuffer[i][0];
            sumAy += accRawBuffer[i][1];
            sumAz += accRawBuffer[i][2];
        }
        float meanAx = sumAx / (float)WINDOW_SIZE;
        float meanAy = sumAy / (float)WINDOW_SIZE;
        float meanAz = sumAz / (float)WINDOW_SIZE;
        float magMean = sqrtf(meanAx * meanAx + meanAy * meanAy + meanAz * meanAz);
        if (magMean < 0.1f) return 0.0f;

        float minCos = 1.0f;
        for (uint16_t i = 0; i < WINDOW_SIZE; ++i) {
            float ax = accRawBuffer[i][0];
            float ay = accRawBuffer[i][1];
            float az = accRawBuffer[i][2];
            float mag = sqrtf(ax * ax + ay * ay + az * az);
            if (mag > 0.1f) {
                float dot = (ax * meanAx + ay * meanAy + az * meanAz) / (mag * magMean);
                if (dot < minCos) minCos = dot;
            }
        }
        if (minCos < -1.0f) minCos = -1.0f;
        if (minCos > 1.0f) minCos = 1.0f;
        return acosf(minCos) * 57.2957795f; // Konversi radian ke derajat
    }

    // Menghitung Crest Factor akselerasi dinamis (Rasio Puncak terhadap Rerata RMS)
    // Hentakan kaki tajam di celana menghasilkan spike impulsif tinggi (Crest Factor > 2.2)
    // Jaket kain meredam getaran sehingga osilasi akselerasi tampak membulat (Crest Factor < 2.0)
    float computeImpactCrestFactor() const {
        float maxAcc = 0.0f;
        float sumSq = 0.0f;
        for (uint16_t i = 0; i < WINDOW_SIZE; ++i) {
            float v = accMagBuffer[i];
            if (v > maxAcc) maxAcc = v;
            sumSq += (v * v);
        }
        float rms = sqrtf(sumSq / (float)WINDOW_SIZE);
        if (rms < 0.01f) return 1.0f;
        return maxAcc / rms;
    }

    // Menghitung Rasio Dominasi Sumbu Utama Giroskop (Principal Axis Dominance)
    // Saku celana pada paha bergerak terkekang pada 1 bidang utama (rotasi pitch sendi panggul).
    // Energi giroskop terkonsentrasi pada sumbu pitch (Rasio Sumbu Dominan >= 0.58).
    // Sebaliknya, saku jaket longgar / ayunan kain bebas berputar dan berguling 3D tanpa kekangan kaku (Rasio < 0.55).
    float computeAxisDominanceRatio() const {
        float energyX = 0.0f, energyY = 0.0f, energyZ = 0.0f;
        for (uint16_t i = 0; i < WINDOW_SIZE; ++i) {
            float gx = gyroBuffer[i][0];
            float gy = gyroBuffer[i][1];
            float gz = gyroBuffer[i][2];
            energyX += (gx * gx);
            energyY += (gy * gy);
            energyZ += (gz * gz);
        }
        float totalEnergy = energyX + energyY + energyZ;
        if (totalEnergy < EPSILON) return 0.333f;
        float maxAxis = fmaxf(energyX, fmaxf(energyY, energyZ));
        return maxAxis / totalEnergy;
    }

    // Menghitung Normalized Jerk Index (Rasio RMS Turunan Akselerasi terhadap Deviasi Standar Akselerasi)
    // Sinyal sinusoidal murni (ayunan tangan bebas di udara): NormJerk ~ 0.10 s.d. 0.16
    // Benturan tumit (heel strike) pada langkah kaki sejati di saku celana: NormJerk >= 0.25 s.d. 0.60+
    float computeNormalizedJerkIndex() const {
        float mag[WINDOW_SIZE];
        float sumMag = 0.0f;
        for (uint16_t i = 0; i < WINDOW_SIZE; ++i) {
            float ax = accRawBuffer[i][0];
            float ay = accRawBuffer[i][1];
            float az = accRawBuffer[i][2];
            mag[i] = sqrtf(ax * ax + ay * ay + az * az);
            sumMag += mag[i];
        }
        float meanMag = sumMag / (float)WINDOW_SIZE;

        float sumSq = 0.0f;
        for (uint16_t i = 0; i < WINDOW_SIZE; ++i) {
            float diff = mag[i] - meanMag;
            sumSq += (diff * diff);
        }
        float stdMag = sqrtf(sumSq / (float)(WINDOW_SIZE - 1));
        if (stdMag < 0.005f) return 0.0f;

        float sumDiffSq = 0.0f;
        for (uint16_t i = 1; i < WINDOW_SIZE; ++i) {
            float d = mag[i] - mag[i - 1];
            sumDiffSq += (d * d);
        }
        float rmsDiff = sqrtf(sumDiffSq / (float)(WINDOW_SIZE - 1));

        return rmsDiff / stdMag;
    }

    // Menghitung Rasio Asimetri Gelombang Giroskop pada Sumbu Dominan (Swing-Stance Asymmetry)
    // Ayunan tangan bebas & saku jaket: gerakan pendulum bolak-balik simetris (Asym ~ 1.0 s.d. 1.3)
    // Langkah kaki paha manusia: fase ayun (swing) cepat vs fase tumpuan (stance) lambat (Asym >= 1.5 s.d. 3.0+)
    float computeSwingStanceAsymmetry() const {
        float eX = 0.0f, eY = 0.0f, eZ = 0.0f;
        for (uint16_t i = 0; i < WINDOW_SIZE; ++i) {
            eX += (gyroBuffer[i][0] * gyroBuffer[i][0]);
            eY += (gyroBuffer[i][1] * gyroBuffer[i][1]);
            eZ += (gyroBuffer[i][2] * gyroBuffer[i][2]);
        }
        uint8_t domAxis = 0;
        if (eY > eX && eY > eZ) domAxis = 1;
        else if (eZ > eX && eZ > eY) domAxis = 2;

        float maxPos = 0.0f;
        float maxNeg = 0.0f;
        for (uint16_t i = 0; i < WINDOW_SIZE; ++i) {
            float g = gyroBuffer[i][domAxis];
            if (g > maxPos) maxPos = g;
            if (-g > maxNeg) maxNeg = -g;
        }

        if (maxPos < 5.0f || maxNeg < 5.0f) return 1.0f;

        float pMax = fmaxf(maxPos, maxNeg);
        float pMin = fminf(maxPos, maxNeg);
        return pMax / (pMin + EPSILON);
    }
};

#endif // FEATURE_EXTRACTION_H