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

    // Perhitungan log-probabilitas emisi Gaussian Multivariat dengan asumsi matriks kovarians diagonal
    float computeLogEmission(const float features[NUM_FEATURES], 
                             const float means[NUM_FEATURES], 
                             const float covars[NUM_FEATURES]) const {
        float logProb = 0.0f;
        for (uint8_t d = 0; d < NUM_FEATURES; ++d) {
            float var = (covars[d] < EPSILON) ? EPSILON : covars[d];
            float diff = features[d] - means[d];
            
            // Formula Gaussian: -0.5 * ln(2 * pi * var) - (diff^2 / (2 * var))
            float term = -0.5f * (logf(2.0f * (float)M_PI * var) + ((diff * diff) / var));
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
        peakIndex = 0;
        currentAdaptiveThreshold = BASE_LOG_THRESHOLD;
    }

    // Inisialisasi parameter model baru dari akumulasi 10 jendela saat Fase Registrasi
    void trainInitialModel(UserModel &model, const float windowFeatures[TARGET_WINDOWS][NUM_FEATURES], const char *name) {
        model.isRegistered = true;
        strncpy(model.userName, name, sizeof(model.userName) - 1);
        model.userName[sizeof(model.userName) - 1] = '\0';

        // 1. Inisialisasi probabilitas awal (Start Prob) merata antar state
        for (uint8_t s = 0; s < NUM_STATES; ++s) {
            model.startProb[s] = 1.0f / (float)NUM_STATES;
        }

        // 2. Inisialisasi matriks transisi keadaan (A) dengan topologi left-to-right teratur
        for (uint8_t i = 0; i < NUM_STATES; ++i) {
            for (uint8_t j = 0; j < NUM_STATES; ++j) {
                if (i == j) {
                    model.transMat[i][j] = 0.60f; // Peluang bertahan di state yang sama
                } else if (j == (i + 1) % NUM_STATES) {
                    model.transMat[i][j] = 0.40f; // Peluang transisi ke siklus langkah berikutnya
                } else {
                    model.transMat[i][j] = 0.0f;
                }
            }
        }

        // 3. Menghitung rata-rata (Means) dan variansi (Covars) per segmen state dari 10 jendela
        uint8_t windowsPerState = TARGET_WINDOWS / NUM_STATES; // 2 jendela per state
        for (uint8_t s = 0; s < NUM_STATES; ++s) {
            uint8_t startWin = s * windowsPerState;
            uint8_t endWin = startWin + windowsPerState;

            // Hitung nilai Mean
            for (uint8_t d = 0; d < NUM_FEATURES; ++d) {
                float sum = 0.0f;
                for (uint8_t w = startWin; w < endWin; ++w) {
                    sum += windowFeatures[w][d];
                }
                model.means[s][d] = sum / (float)windowsPerState;
            }

            // Hitung nilai Covariance (Variansi)
            for (uint8_t d = 0; d < NUM_FEATURES; ++d) {
                float sumVar = 0.0f;
                for (uint8_t w = startWin; w < endWin; ++w) {
                    float diff = windowFeatures[w][d] - model.means[s][d];
                    sumVar += (diff * diff);
                }
                float calculatedVar = sumVar / (float)windowsPerState;
                model.covars[s][d] = (calculatedVar < 0.01f) ? 0.01f : calculatedVar; // Mencegah singularitas
            }
        }
    }

    // Menghitung akumulasi skor Forward GHMM per jendela waktu (3 detik)
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

        // Update Peak Tracking untuk ambang batas adaptif dari riwayat langkah
        peakWindowScores[peakIndex] = totalLogProb;
        peakIndex = (peakIndex + 1) % 5;

        float averagePeak = 0.0f;
        for (uint8_t i = 0; i < 5; ++i) {
            averagePeak += peakWindowScores[i];
        }
        averagePeak /= 5.0f;
        currentAdaptiveThreshold = averagePeak * 1.15f; // Margin toleransi 15% fluktuasi

        return totalLogProb;
    }

    // Mengonversi log-likelihood menjadi nilai keyakinan persentase (Confidence Score 0 - 100%)
    float calculateConfidenceScore(float logProb) const {
        if (logProb <= -300.0f) return 0.0f;
        if (logProb >= currentAdaptiveThreshold) {
            float ratio = (logProb - currentAdaptiveThreshold) / fabsf(currentAdaptiveThreshold);
            float score = 85.0f + (ratio * 15.0f);
            return (score > 100.0f) ? 100.0f : score;
        } else {
            float ratio = (currentAdaptiveThreshold - logProb) / fabsf(currentAdaptiveThreshold);
            float score = 85.0f - (ratio * 50.0f);
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

            // Pembaruan variansi adaptif
            float diff = features[d] - newMean;
            float newVar = (EMA_ALPHA * (diff * diff)) + ((1.0f - EMA_ALPHA) * model.covars[bestState][d]);
            model.covars[bestState][d] = (newVar < 0.01f) ? 0.01f : newVar;

            totalDelta += fabsf(newMean - oldMean);
        }

        return totalDelta; // Mengembalikan besaran koreksi untuk log telemetri
    }

    float getAdaptiveThreshold() const {
        return currentAdaptiveThreshold;
    }
};

#endif // GHMM_CLASSIFIER_H