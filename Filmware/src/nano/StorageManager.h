#ifndef STORAGE_MANAGER_H
#define STORAGE_MANAGER_H

#include <Arduino.h>
#include <KVStore.h>
#include <kvstore_global_api.h>
#include <mbed_error.h>
#include "Config.h"

// Format lama untuk kompatibilitas data transisi di Flash
struct UserModelOld {
    bool isRegistered;
    char userName[16];
    float startProb[NUM_STATES];
    float transMat[NUM_STATES][NUM_STATES];
    float means[NUM_STATES][NUM_FEATURES];
    float covars[NUM_STATES][NUM_FEATURES];
    float baselineLogProb;
};

class StorageManager {
private:
    static void getUserKey(uint8_t slotIndex, char *keyBuffer, size_t maxLen) {
        snprintf(keyBuffer, maxLen, "/kv/usr_%d", slotIndex);
    }

public:
    static void begin() {
        Serial.println(F("[STORAGE] Mbed KVStore Flash Siap"));
    }

    // Menyimpan struct model pengguna ke Flash
    static bool saveUser(uint8_t slotIndex, const UserModel &model) {
        if (slotIndex >= MAX_USERS) return false;

        char key[16];
        getUserKey(slotIndex, key, sizeof(key));

        // JANGAN panggil kv_remove(key) sebelum kv_set!
        // kv_set di Mbed OS TDBStore secara otomatis meng-update data key yang sudah ada.
        // Memanggil kv_remove sebelumnya akan menulis tombstone record 'deleted' ke Flash,
        // melipatgandakan konsumsi memori sektor dan memicu MBED_ERROR_MEDIA_FULL saat banyak slot.
        int res = kv_set(key, &model, sizeof(UserModel), 0);
        Serial.print(F("[STORAGE] Simpan User Slot "));
        Serial.print(slotIndex);
        Serial.print(F(" ("));
        Serial.print(model.userName);
        Serial.print(F(") -> KVStore res: "));
        Serial.println(res);

        // Jika kv_set gagal (misal fragmentasi TDBStore), coba fallback kv_remove lalu kv_set ulang
        if (res != 0) {
            Serial.println(F("[STORAGE] kv_set gagal, mencoba fallback kv_remove & kv_set ulang..."));
            kv_remove(key);
            res = kv_set(key, &model, sizeof(UserModel), 0);
            Serial.print(F("[STORAGE] Fallback kv_set res: "));
            Serial.println(res);
        }

        return (res == 0); // 0 menandakan operasi sukses pada Mbed KVStore
    }

    // Membaca model pengguna dari Flash ke RAM dengan auto-migrasi format lama
    static bool loadUser(uint8_t slotIndex, UserModel &model) {
        if (slotIndex >= MAX_USERS) return false;

        char key[16];
        getUserKey(slotIndex, key, sizeof(key));

        uint8_t buffer[sizeof(UserModel)];
        size_t actualSize = 0;
        int res = kv_get(key, buffer, sizeof(buffer), &actualSize);

        if (res == 0) {
            if (actualSize == sizeof(UserModel)) {
                memcpy(&model, buffer, sizeof(UserModel));
                Serial.print(F("[STORAGE] Muat User Slot "));
                Serial.print(slotIndex);
                Serial.print(F(" ("));
                Serial.print(model.userName);
                Serial.println(F(") -> OK (Format Baru)"));
                return model.isRegistered;
            } else if (actualSize == sizeof(UserModelOld)) {
                UserModelOld oldModel;
                memcpy(&oldModel, buffer, sizeof(UserModelOld));
                memset(&model, 0, sizeof(UserModel));
                model.isRegistered = oldModel.isRegistered;
                strncpy(model.userName, oldModel.userName, sizeof(model.userName) - 1);
                model.userName[sizeof(model.userName) - 1] = '\0';
                for (uint8_t s = 0; s < NUM_STATES; ++s) {
                    model.startProb[s] = oldModel.startProb[s];
                    for (uint8_t j = 0; j < NUM_STATES; ++j) {
                        model.transMat[s][j] = oldModel.transMat[s][j];
                    }
                    for (uint8_t f = 0; f < NUM_FEATURES; ++f) {
                        model.means[s][f] = oldModel.means[s][f];
                        model.covars[s][f] = oldModel.covars[s][f];
                    }
                }
                model.baselineLogProb = oldModel.baselineLogProb;
                Serial.print(F("[STORAGE] Muat User Slot "));
                Serial.print(slotIndex);
                Serial.print(F(" ("));
                Serial.print(model.userName);
                Serial.println(F(") -> OK (Migrasi dari Format Lama)"));
                // Upgrade penyimpanan ke format baru
                saveUser(slotIndex, model);
                return model.isRegistered;
            }
        }

        model.isRegistered = false;
        return false;
    }

    // Menghapus spesifik profil pengguna
    static bool deleteUser(uint8_t slotIndex) {
        if (slotIndex >= MAX_USERS) return false;

        char key[16];
        getUserKey(slotIndex, key, sizeof(key));

        int res = kv_remove(key);
        Serial.print(F("[STORAGE] deleteUser Slot "));
        Serial.print(slotIndex);
        Serial.print(F(" -> kv_remove res: "));
        Serial.println(res);

        // Jika kv_remove gagal (misal sektor penuh), timpa dengan record isRegistered=false
        if (res != 0 && res != MBED_ERROR_ITEM_NOT_FOUND) {
            UserModel emptyModel;
            memset(&emptyModel, 0, sizeof(UserModel));
            emptyModel.isRegistered = false;
            kv_set(key, &emptyModel, sizeof(UserModel), 0);
        }

        return (res == 0 || res == MBED_ERROR_ITEM_NOT_FOUND);
    }

    // Menghapus seluruh profil pengguna dan membersihkan partisi Flash secara total
    static bool clearAllUsers() {
        int res = kv_reset("/kv/");
        Serial.print(F("[STORAGE] clearAllUsers (kv_reset) res: "));
        Serial.println(res);
        if (res != 0) {
            for (uint8_t i = 0; i < MAX_USERS; ++i) {
                deleteUser(i);
            }
        }
        return (res == 0);
    }

    static uint8_t countRegisteredUsers() {
        uint8_t count = 0;
        UserModel tempModel;
        for (uint8_t i = 0; i < MAX_USERS; ++i) {
            if (loadUser(i, tempModel)) {
                count++;
            }
        }
        return count;
    }
};

#endif // STORAGE_MANAGER_H
