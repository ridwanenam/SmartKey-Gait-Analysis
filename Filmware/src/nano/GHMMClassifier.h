#ifndef GHMM_CLASSIFIER_H
#define GHMM_CLASSIFIER_H

#include <Arduino.h>
#include <math.h>
#include "Config.h"

class GHMMClassifier {
private:
    float alphaForward[NUM_STATES];
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

    // Ambang batas bawah (Floor) dan atas (Ceiling) variansi absolut per dimensi fitur fisik
    // Floor menjamin elastisitas fisiologis alami tubuh manusia (mencegah overfitting / zero-variance singularity)
    // Ceiling membatasi toleransi maksimum (mencegah model menyerap gaya jalan orang lain / underfitting)
    static inline float clampVariance(uint8_t d, float rawVar) {
        // Feature 0: Mean Gyro (~40-90 deg/s)    -> Floor 14.0f (std ~3.74 deg/s), Ceil 55.0f (std ~7.42 deg/s)
        // Feature 1: StdDev Gyro (~20-50 deg/s)  -> Floor 10.0f (std ~3.16 deg/s), Ceil 45.0f (std ~6.71 deg/s)
        // Feature 2: Cadence Regularity (~40-80%)-> Floor 20.0f (std ~4.47%),       Ceil 65.0f (std ~8.06%)
        // Feature 3: Step Period (~40-75 smp)   -> Floor 12.0f (std ~3.46 smp),    Ceil 45.0f (std ~6.71 smp)
        // Feature 4: Heel Impact (~15-45 %g)    -> Floor 15.0f (std ~3.87 %g),     Ceil 55.0f (std ~7.42 %g)
        static const float MIN_ABS_VAR_FLOOR[NUM_FEATURES] = { 14.0f, 10.0f, 20.0f, 12.0f, 15.0f };
        static const float MAX_ABS_VAR_CEIL[NUM_FEATURES]  = { 55.0f, 45.0f, 65.0f, 45.0f, 55.0f };
        if (d >= NUM_FEATURES) return 1.0f;
        if (rawVar < MIN_ABS_VAR_FLOOR[d]) return MIN_ABS_VAR_FLOOR[d];
        if (rawVar > MAX_ABS_VAR_CEIL[d])  return MAX_ABS_VAR_CEIL[d];
        return rawVar;
    }

    // Perhitungan log-probabilitas emisi Gaussian Multivariat dengan asumsi matriks kovarians diagonal
    float computeLogEmission(const float features[NUM_FEATURES], 
                             const float means[NUM_FEATURES], 
                             const float covars[NUM_FEATURES]) const {
        float logProb = 0.0f;
        for (uint8_t d = 0; d < NUM_FEATURES; ++d) {
            float var = clampVariance(d, covars[d]);
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
    GHMMClassifier() : currentAdaptiveThreshold(BASE_LOG_THRESHOLD) {
        resetInference();
    }

    // Reset variabel forward algorithm di awal siklus autentikasi
    void resetInference() {
        for (uint8_t s = 0; s < NUM_STATES; ++s) {
            alphaForward[s] = -1e9f;
        }
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

        // Tahap 1 Sanitasi: Lewati jendela transisi awal (Window 0 = start dari kondisi diam)
        // Gunakan jendela langkah berjalan stabil (Windows 1 s.d. TARGET_WINDOWS - 1)
        uint8_t steadyStart = (TARGET_WINDOWS >= 4) ? 1 : 0;
        uint8_t steadyCount = TARGET_WINDOWS - steadyStart;

        // 3. Menghitung variansi dasar global dari jendela training stabil dengan batas bawah (Floor) dan atas (Ceiling)
        float globalVar[NUM_FEATURES];
        for (uint8_t d = 0; d < NUM_FEATURES; ++d) {
            float globalMean = 0.0f;
            for (uint8_t w = steadyStart; w < TARGET_WINDOWS; ++w) {
                globalMean += windowFeatures[w][d];
            }
            globalMean /= (float)steadyCount;
            float sumVar = 0.0f;
            for (uint8_t w = steadyStart; w < TARGET_WINDOWS; ++w) {
                float diff = windowFeatures[w][d] - globalMean;
                sumVar += (diff * diff);
            }
            float v = sumVar / (float)(steadyCount > 1 ? (steadyCount - 1) : 1);
            globalVar[d] = clampVariance(d, v);
        }

        // 4. Menghitung rata-rata (Means) dan variansi (Covars) per segmen state dengan batas bawah dan atas
        for (uint8_t s = 0; s < NUM_STATES; ++s) {
            uint8_t startWin = steadyStart + (s * steadyCount) / NUM_STATES;
            uint8_t endWin = steadyStart + ((s + 1) * steadyCount) / NUM_STATES;
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
                model.covars[s][d] = clampVariance(d, calculatedVar);
            }
        }

        // 5. Evaluasi mandiri (Self-Evaluation) pada data registrasi untuk menetapkan baselineLogProb
        // Gunakan jendela langkah berjalan stabil (steadyStart s.d. TARGET_WINDOWS - 1)
        float alphaTrain[NUM_STATES];
        for (uint8_t j = 0; j < NUM_STATES; ++j) {
            float logPi = (model.startProb[j] < EPSILON) ? logf(EPSILON) : logf(model.startProb[j]);
            float logB = computeLogEmission(windowFeatures[steadyStart], model.means[j], model.covars[j]);
            alphaTrain[j] = logPi + logB;
        }
        float sumBaselineLL = -1e9f;
        for (uint8_t s = 0; s < NUM_STATES; ++s) {
            sumBaselineLL = logAdd(sumBaselineLL, alphaTrain[s]);
        }
        float totalTrainingNormLL = sumBaselineLL;
        uint8_t evalSteps = 1;

        for (uint8_t w = steadyStart + 1; w < TARGET_WINDOWS; ++w) {
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
            evalSteps++;
            float curTotalLL = -1e9f;
            for (uint8_t s = 0; s < NUM_STATES; ++s) {
                curTotalLL = logAdd(curTotalLL, alphaTrain[s]);
            }
            totalTrainingNormLL += (curTotalLL / (float)evalSteps);
        }

        float avgBaseLL = totalTrainingNormLL / (float)evalSteps;
        if (avgBaseLL > -5.0f || avgBaseLL < -60.0f) {
            avgBaseLL = BASE_LOG_THRESHOLD;
        }
        model.baselineLogProb = avgBaseLL;
        Serial.print(F("[TRAIN] Baseline Log-Likelihood Ditetapkan: "));
        Serial.println(model.baselineLogProb);
    }

    // Menghitung skor Forward GHMM dengan Normalisasi Panjang Urutan (Average Log-Likelihood)
    // Jendela 1 diperlakukan sebagai warm-up / start akselerasi dari kondisi diam.
    // Mulai Jendela 2 s.d. 5 (steady-state gait), Forward chain di-anchor dan dievaluasi secara stabil.
    float evaluateWindow(const UserModel &model, const float features[NUM_FEATURES], uint8_t windowStep) {
        float newAlpha[NUM_STATES];

        if (windowStep <= 1) {
            // Tahap Warm-up (Jendela 1): Evaluasi inisialisasi emisi langkah awal dari kondisi diam
            for (uint8_t j = 0; j < NUM_STATES; ++j) {
                float logPi = (model.startProb[j] < EPSILON) ? logf(EPSILON) : logf(model.startProb[j]);
                float logB = computeLogEmission(features, model.means[j], model.covars[j]);
                newAlpha[j] = logPi + logB;
            }
        } else if (windowStep == 2) {
            // Tahap Re-Anchor Steady-State (Jendela 2): Mulai rantai Forward murni dari langkah konstan
            for (uint8_t j = 0; j < NUM_STATES; ++j) {
                float logPi = (model.startProb[j] < EPSILON) ? logf(EPSILON) : logf(model.startProb[j]);
                float logB = computeLogEmission(features, model.means[j], model.covars[j]);
                newAlpha[j] = logPi + logB;
            }
        } else {
            // Tahap Induksi (Jendela 3 s.d. 5): alpha_t(j) = [sum_i alpha_{t-1}(i) * a_ij] * b_j(O_t)
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

        // Normalisasi Panjang Urutan Steady-State
        // Jendela 1: panjang 1 (umpan balik progres langsung ke UI)
        // Jendela 2: panjang 1 (re-anchor steady step 1)
        // Jendela 3: panjang 2
        // Jendela 4: panjang 3
        // Jendela 5: panjang 4 (evaluasi 4 jendela steady-state 2 s.d. 5)
        uint8_t effStep = (windowStep <= 1) ? 1 : (windowStep - 1);
        float normalizedLogProb = totalLogProb / (float)effStep;

        // Tautkan ambang batas secara solid ke Golden Baseline Registrasi Profil Pengguna
        // Tidak lagi ditarik melar ke bawah oleh sinyal anomali atau penyerang (Anti-Threshold Drift)
        float baseLL = (model.baselineLogProb <= -5.0f && model.baselineLogProb >= -60.0f) 
                       ? model.baselineLogProb : BASE_LOG_THRESHOLD;
        
        // Ambang batas lolos (80.0% CIR) dipatok pada (baseLL - 5.5 log-unit)
        // Memberikan toleransi variasi alami langkah kaki manusia (90% interval kepercayaan chi-square 5D)
        currentAdaptiveThreshold = baseLL - 5.5f;

        return normalizedLogProb;
    }

    // Mengonversi log-likelihood ternormalisasi menjadi nilai keyakinan persentase (Confidence Score 0 - 100%)
    // Skala Terkalibrasi Proporsional Penuh (0.0% s.d. 100.0%) Bebas Ceiling Clamping, Berbasis Jarak Baseline Ideal
    float calculateConfidenceScore(float normLogProb) const {
        if (normLogProb <= -70.0f) return 0.0f; // Anomali ekstrem
        
        float baselineTh = (currentAdaptiveThreshold > -5.0f) ? BASE_LOG_THRESHOLD : currentAdaptiveThreshold;

        // Rentang dari Ambang Kelulusan (80.0%) menuju Golden Baseline Registrasi (92.0%): 5.5 log-unit
        const float SPAN_TO_BASE = 5.5f;

        if (normLogProb >= baselineTh) {
            float delta = normLogProb - baselineTh;
            if (delta <= SPAN_TO_BASE) {
                // Rentang dari Ambang Batas (80.0%) menuju Golden Baseline Registrasi (92.0%)
                return 80.0f + (delta / SPAN_TO_BASE) * 12.0f;
            } else {
                // Melampaui Golden Baseline (lebih konsisten dari saat registrasi):
                // Bertumbuh asimtotik dari 92.0% menuju 99.5% tanpa terhambat ceiling kaku
                float excess = delta - SPAN_TO_BASE;
                float score = 92.0f + 7.8f * (1.0f - expf(-0.35f * excess));
                return (score > 100.0f) ? 100.0f : score;
            }
        } else {
            float drop = baselineTh - normLogProb;
            if (drop <= 4.0f) {
                // Penurunan bertahap halus untuk deviasi minor: 80.0% turun ke 60.0%
                return 80.0f - (drop / 4.0f) * 20.0f;
            } else if (drop <= 10.0f) {
                // Penurunan tegas untuk deviasi moderat/profil lain: 60.0% turun ke 20.0%
                float excessDrop = drop - 4.0f;
                return 60.0f - (excessDrop / 6.0f) * 40.0f;
            } else {
                // Penurunan lanjut menuju 0.0% (anomali berat / non-gait)
                float excessDrop = drop - 10.0f;
                float score = 20.0f - (excessDrop / 6.0f) * 20.0f;
                return (score < 0.0f) ? 0.0f : score;
            }
        }
    }

    float getAdaptiveThreshold() const {
        return currentAdaptiveThreshold;
    }
};

#endif // GHMM_CLASSIFIER_H