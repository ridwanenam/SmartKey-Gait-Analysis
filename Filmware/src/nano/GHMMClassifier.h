#ifndef GHMM_CLASSIFIER_H
#define GHMM_CLASSIFIER_H

#include <Arduino.h>
#include <math.h>
#include "Config.h"

class GHMMClassifier {
private:
    float alphaForward[NUM_STATES];
    float peakWindowScores[5];
    uint8_t peakIndex;
    float currentAdaptiveThreshold;

    // Log-sum-exp trick untuk mencegah underflow numerik pada perkalian probabilitas
    static inline float logAdd(float logA, float logB) {
        if (logA <= -1e8f) return logB;
        if (logB <= -1e8f) return logA;
        if (logA > logB) {
            return logA + logf(1.0f + expf(logB - logA));
        } else {
            return logB + logf(1.0f + expf(logA - logB));
        }
    }

    // Ambang batas bawah variansi (Variance Floor) absolut per dimensi fitur fisik
    static inline float getVarianceFloor(uint8_t d) {
        // Feature 0: Mean Gyro (~50-100 deg/s) -> var floor 25.0f (std ~5.0 deg/s)
        // Feature 1: StdDev Gyro (~20-45 deg/s) -> var floor 25.0f (std ~5.0 deg/s)
        // Feature 2: Cadence Regularity (~60-90%) -> var floor 36.0f (std ~6.0%)
        // Feature 3: Step Period (~45-70 smp) -> var floor 25.0f (std ~5.0 smp = 50ms toleransi)
        // Feature 4: Heel-Strike Impact (~30-70 %g) -> var floor 25.0f (std ~5.0 %g)
        static const float MIN_ABS_VAR_FLOOR[NUM_FEATURES] = { 25.0f, 25.0f, 36.0f, 25.0f, 25.0f };
        return (d < NUM_FEATURES) ? MIN_ABS_VAR_FLOOR[d] : 1.0f;
    }

    // Perhitungan log-probabilitas emisi Gaussian Multivariat dengan asumsi matriks kovarians diagonal
    float computeLogEmission(const float features[NUM_FEATURES], 
                             const float means[NUM_FEATURES], 
                             const float covars[NUM_FEATURES]) const {
        float logProb = 0.0f;
        for (uint8_t d = 0; d < NUM_FEATURES; ++d) {
            float floorVal = getVarianceFloor(d);
            float var = (covars[d] < floorVal) ? floorVal : covars[d];
            float diff = features[d] - means[d];
            float mahalanobisSq = (diff * diff) / var;
            
            // Robust loss: batasi penalti kuadrat per dimensi (maks 36.0f = ~6.0 sigma)
            // Cukup toleran untuk variasi gaya jalan wajar (jarak < 9.0),
            // namun tegas menghukum deviasi besar seperti ayunan tangan palsu (jarak > 30.0)
            if (mahalanobisSq > 36.0f) mahalanobisSq = 36.0f;
            
            // Formula Gaussian: -0.5 * ln(2 * pi * var) - 0.5 * mahalanobisSq
            float term = -0.5f * (logf(2.0f * (float)M_PI * var) + mahalanobisSq);
            logProb += term;
        }
        return logProb;
    }

public:
    GHMMClassifier() : peakIndex(0), currentAdaptiveThreshold(BASE_LOG_THRESHOLD) {
        resetInference();
        for (uint8_t i = 0; i < 5; ++i) {
            peakWindowScores[i] = BASE_LOG_THRESHOLD;
        }
    }

    // Reset variabel forward algorithm di awal siklus autentikasi
    void resetInference() {
        for (uint8_t s = 0; s < NUM_STATES; ++s) {
            alphaForward[s] = -1e9f;
        }
        for (uint8_t i = 0; i < 5; ++i) {
            peakWindowScores[i] = BASE_LOG_THRESHOLD;
        }
        peakIndex = 0;
        currentAdaptiveThreshold = BASE_LOG_THRESHOLD;
    }

    // Inisialisasi parameter model baru saat Fase Registrasi
    void trainInitialModel(UserModel &model, const float windowFeatures[TARGET_WINDOWS][NUM_FEATURES], const char *name) {
        model.isRegistered = true;
        strncpy(model.userName, name, sizeof(model.userName) - 1);
        model.userName[sizeof(model.userName) - 1] = '\0';

        // 1. Inisialisasi probabilitas awal (Start Prob) merata antar state
        for (uint8_t s = 0; s < NUM_STATES; ++s) {
            model.startProb[s] = 1.0f / (float)NUM_STATES;
        }

        // 2. Inisialisasi matriks transisi keadaan (A) 2-state siklus langkah bergantian (Stance vs Swing)
        for (uint8_t i = 0; i < NUM_STATES; ++i) {
            for (uint8_t j = 0; j < NUM_STATES; ++j) {
                if (i == j) {
                    model.transMat[i][j] = 0.55f; // Peluang bertahan di state yang sama
                } else {
                    model.transMat[i][j] = 0.45f; // Peluang transisi ke siklus langkah berikutnya
                }
            }
        }

        // 3. Menghitung variansi dasar global dari seluruh jendela training dengan batas bawah variansi (Variance Floor)
        float globalVar[NUM_FEATURES];
        for (uint8_t d = 0; d < NUM_FEATURES; ++d) {
            float globalMean = 0.0f;
            for (uint8_t w = 0; w < TARGET_WINDOWS; ++w) {
                globalMean += windowFeatures[w][d];
            }
            globalMean /= (float)TARGET_WINDOWS;
            float sumVar = 0.0f;
            for (uint8_t w = 0; w < TARGET_WINDOWS; ++w) {
                float diff = windowFeatures[w][d] - globalMean;
                sumVar += (diff * diff);
            }
            float v = sumVar / (float)(TARGET_WINDOWS > 1 ? (TARGET_WINDOWS - 1) : 1);
            float floorVal = getVarianceFloor(d);
            globalVar[d] = (v < floorVal) ? floorVal : v;
        }

        // 4. Menghitung rata-rata (Means) dan variansi (Covars) per segmen state dengan batas bawah
        for (uint8_t s = 0; s < NUM_STATES; ++s) {
            uint8_t startWin = (s * TARGET_WINDOWS) / NUM_STATES;
            uint8_t endWin = ((s + 1) * TARGET_WINDOWS) / NUM_STATES;
            if (endWin <= startWin) endWin = startWin + 1;
            if (endWin > TARGET_WINDOWS) endWin = TARGET_WINDOWS;

            for (uint8_t d = 0; d < NUM_FEATURES; ++d) {
                float sum = 0.0f;
                uint8_t cnt = 0;
                for (uint8_t w = startWin; w < endWin; ++w) {
                    sum += windowFeatures[w][d];
                    cnt++;
                }
                model.means[s][d] = (cnt > 0) ? (sum / (float)cnt) : windowFeatures[startWin][d];

                float segSumVar = 0.0f;
                for (uint8_t w = startWin; w < endWin; ++w) {
                    float diff = windowFeatures[w][d] - model.means[s][d];
                    segSumVar += (diff * diff);
                }
                float calculatedVar = (cnt > 1) ? (segSumVar / (float)(cnt - 1)) : globalVar[d];
                float floorVal = getVarianceFloor(d);
                model.covars[s][d] = (calculatedVar < floorVal) ? floorVal : calculatedVar;
            }
        }

        // 5. Evaluasi mandiri (Self-Evaluation) pada data registrasi untuk menetapkan baselineLogProb
        float alphaTrain[NUM_STATES];
        for (uint8_t j = 0; j < NUM_STATES; ++j) {
            float logPi = (model.startProb[j] < EPSILON) ? logf(EPSILON) : logf(model.startProb[j]);
            float logB = computeLogEmission(windowFeatures[0], model.means[j], model.covars[j]);
            alphaTrain[j] = logPi + logB;
        }
        float sumBaselineLL = -1e9f;
        for (uint8_t s = 0; s < NUM_STATES; ++s) {
            sumBaselineLL = logAdd(sumBaselineLL, alphaTrain[s]);
        }
        float totalTrainingNormLL = sumBaselineLL;

        for (uint8_t w = 1; w < TARGET_WINDOWS; ++w) {
            float nextAlpha[NUM_STATES];
            for (uint8_t j = 0; j < NUM_STATES; ++j) {
                float logSum = -1e9f;
                for (uint8_t i = 0; i < NUM_STATES; ++i) {
                    float logA = (model.transMat[i][j] < EPSILON) ? logf(EPSILON) : logf(model.transMat[i][j]);
                    logSum = logAdd(logSum, alphaTrain[i] + logA);
                }
                float logB = computeLogEmission(windowFeatures[w], model.means[j], model.covars[j]);
                nextAlpha[j] = logSum + logB;
            }
            for (uint8_t s = 0; s < NUM_STATES; ++s) {
                alphaTrain[s] = nextAlpha[s];
            }
            float curTotalLL = -1e9f;
            for (uint8_t s = 0; s < NUM_STATES; ++s) {
                curTotalLL = logAdd(curTotalLL, alphaTrain[s]);
            }
            totalTrainingNormLL += (curTotalLL / (float)(w + 1));
        }

        float avgBaseLL = totalTrainingNormLL / (float)TARGET_WINDOWS;
        if (avgBaseLL > -5.0f || avgBaseLL < -60.0f) {
            avgBaseLL = BASE_LOG_THRESHOLD;
        }
        model.baselineLogProb = avgBaseLL;
        Serial.print(F("[TRAIN] Baseline Log-Likelihood Ditetapkan: "));
        Serial.println(model.baselineLogProb);
    }

    // Menghitung skor Forward GHMM dengan Normalisasi Panjang Urutan (Average Log-Likelihood)
    float evaluateWindow(const UserModel &model, const float features[NUM_FEATURES], uint8_t windowStep) {
        float newAlpha[NUM_STATES];

        if (windowStep == 1) {
            // Tahap Inisialisasi: alpha_1(j) = pi_j * b_j(O_1)
            for (uint8_t j = 0; j < NUM_STATES; ++j) {
                float logPi = (model.startProb[j] < EPSILON) ? logf(EPSILON) : logf(model.startProb[j]);
                float logB = computeLogEmission(features, model.means[j], model.covars[j]);
                newAlpha[j] = logPi + logB;
            }
        } else {
            // Tahap Induksi: alpha_t(j) = [sum_i alpha_{t-1}(i) * a_ij] * b_j(O_t)
            for (uint8_t j = 0; j < NUM_STATES; ++j) {
                float logSum = -1e9f;
                for (uint8_t i = 0; i < NUM_STATES; ++i) {
                    float logA = (model.transMat[i][j] < EPSILON) ? logf(EPSILON) : logf(model.transMat[i][j]);
                    logSum = logAdd(logSum, alphaForward[i] + logA);
                }
                float logB = computeLogEmission(features, model.means[j], model.covars[j]);
                newAlpha[j] = logSum + logB;
            }
        }

        // Simpan state baru ke memori rekursif
        for (uint8_t s = 0; s < NUM_STATES; ++s) {
            alphaForward[s] = newAlpha[s];
        }

        // Terminasi skor total jendela berjalan: log P(O | lambda) = logSum(alpha_T)
        float totalLogProb = -1e9f;
        for (uint8_t s = 0; s < NUM_STATES; ++s) {
            totalLogProb = logAdd(totalLogProb, alphaForward[s]);
        }

        // Normalisasi Panjang Urutan (Length-Normalized Log-Likelihood)
        float normalizedLogProb = totalLogProb / (float)(windowStep > 0 ? windowStep : 1);

        // Update Peak Tracking untuk ambang batas adaptif menggunakan normalized LL
        peakWindowScores[peakIndex] = normalizedLogProb;
        peakIndex = (peakIndex + 1) % 5;

        // Rata-ratakan hanya sebanyak jendela yang sudah benar-benar masuk (tanpa terdistorsi nilai dummy awal)
        uint8_t activeCount = (windowStep < 5) ? (windowStep > 0 ? windowStep : 1) : 5;
        float averagePeak = 0.0f;
        for (uint8_t i = 0; i < activeCount; ++i) {
            averagePeak += peakWindowScores[i];
        }
        averagePeak /= (float)activeCount;

        // Tautkan ambang batas adaptif ke Baseline Log-Likelihood Profil Registrasi Pengguna
        float baseLL = (model.baselineLogProb <= -5.0f && model.baselineLogProb >= -60.0f) 
                       ? model.baselineLogProb : BASE_LOG_THRESHOLD;
        
        float dynamicTh = averagePeak * 1.25f; // Margin toleransi 25%

        // Batas Bawah Keras (Hard Floor): Ambang batas tidak boleh jatuh lebih rendah dari (baseLL - 5.5)
        // Menjaga agar toleransi adaptif tidak melar berlebihan saat anomali
        float hardFloorTh = baseLL - 5.5f;
        if (dynamicTh < hardFloorTh) {
            dynamicTh = hardFloorTh;
        }
        // Batas Atas: Ambang batas tidak boleh lebih tinggi dari (baseLL - 1.0) agar langkah normal pengguna sah tetap nyaman lolos
        if (dynamicTh > baseLL - 1.0f) {
            dynamicTh = baseLL - 1.0f;
        }

        currentAdaptiveThreshold = dynamicTh;

        return normalizedLogProb;
    }

    // Mengonversi log-likelihood ternormalisasi menjadi nilai keyakinan persentase (Confidence Score 0 - 100%)
    float calculateConfidenceScore(float normLogProb) const {
        if (normLogProb <= -70.0f) return 0.0f; // Anomali ekstrem
        
        float baselineTh = (currentAdaptiveThreshold > -5.0f) ? BASE_LOG_THRESHOLD : currentAdaptiveThreshold;
        float margin = fabsf(baselineTh);
        if (margin < 1.0f) margin = 1.0f;

        // Titik ambang batas tepat (normLogProb == baselineTh) adalah 80.0% (Ambang Batas Akses Sah)
        if (normLogProb >= baselineTh) {
            // Skala 80.0% s.d. 98.0% untuk sinyal yang di atas threshold
            float ratio = (normLogProb - baselineTh) / margin;
            if (ratio > 1.0f) ratio = 1.0f;
            float score = 80.0f + (ratio * 18.0f);
            return (score > 100.0f) ? 100.0f : score;
        } else {
            // Skala 80.0% turun tajam ke 0.0% untuk sinyal di bawah threshold
            float ratio = (baselineTh - normLogProb) / margin;
            float score = 80.0f - (ratio * 100.0f);
            return (score < 0.0f) ? 0.0f : score;
        }
    }

    // Incremental Personalization (Self-Adaptive GHMM) berbasis rumus Exponential Moving Average (EMA)
    float updateModelEMA(UserModel &model, const float features[NUM_FEATURES]) {
        float totalDelta = 0.0f;
        
        // Memperbarui Mean dan Kovarians pada state yang memiliki bobot aktivasi tertinggi
        uint8_t bestState = 0;
        float maxAlpha = alphaForward[0];
        for (uint8_t s = 1; s < NUM_STATES; ++s) {
            if (alphaForward[s] > maxAlpha) {
                maxAlpha = alphaForward[s];
                bestState = s;
            }
        }

        for (uint8_t d = 0; d < NUM_FEATURES; ++d) {
            float oldMean = model.means[bestState][d];
            // Rumus EMA: mu_baru = alpha * O_t + (1 - alpha) * mu_lama
            float newMean = (EMA_ALPHA * features[d]) + ((1.0f - EMA_ALPHA) * oldMean);
            model.means[bestState][d] = newMean;

            // Bekukan kovarians (covars) agar tidak terjadi threshold drift dan batas toleransi tidak melebar tak terkendali
            totalDelta += fabsf(newMean - oldMean);
        }

        return totalDelta; // Mengembalikan besaran koreksi untuk log telemetri
    }

    float getAdaptiveThreshold() const {
        return currentAdaptiveThreshold;
    }
};

#endif // GHMM_CLASSIFIER_H