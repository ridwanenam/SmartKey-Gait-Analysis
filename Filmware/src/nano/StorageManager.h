#ifndef STORAGE_MANAGER_H
#define STORAGE_MANAGER_H

#include <Arduino.h>
#include <KVStore.h>
#include <kvstore_global_api.h>
#include <mbed_error.h>
#include "Config.h"

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

        // Hapus key lama terlebih dahulu untuk mencegah kegagalan fragmentasi TDBStore
        kv_remove(key);

        int res = kv_set(key, &model, sizeof(UserModel), 0);
        Serial.print(F("[STORAGE] Simpan User Slot "));
        Serial.print(slotIndex);
        Serial.print(F(" ("));
        Serial.print(model.userName);
        Serial.print(F(") -> KVStore res: "));
        Serial.println(res);

        return (res == 0); // 0 menandakan operasi sukses pada Mbed KVStore
    }

    // Membaca model pengguna dari Flash ke RAM
    static bool loadUser(uint8_t slotIndex, UserModel &model) {
        if (slotIndex >= MAX_USERS) return false;

        char key[16];
        getUserKey(slotIndex, key, sizeof(key));

        size_t actualSize = 0;
        int res = kv_get(key, &model, sizeof(UserModel), &actualSize);

        if (res == 0 && (actualSize == sizeof(UserModel) || actualSize == sizeof(UserModel) - sizeof(float))) {
            if (actualSize == sizeof(UserModel) - sizeof(float)) {
                model.baselineLogProb = BASE_LOG_THRESHOLD;
            }
            // Auto-upgrade: Pastikan transMat memiliki probabilitas latar belakang semi-ergodik (0.05) untuk profil lama
            for (uint8_t i = 0; i < NUM_STATES; ++i) {
                float rowSum = 0.0f;
                for (uint8_t j = 0; j < NUM_STATES; ++j) {
                    if (i != j && j != (i + 1) % NUM_STATES && model.transMat[i][j] < 0.01f) {
                        model.transMat[i][j] = 0.05f;
                    }
                    rowSum += model.transMat[i][j];
                }
                if (rowSum > EPSILON && fabsf(rowSum - 1.0f) > 0.01f) {
                    for (uint8_t j = 0; j < NUM_STATES; ++j) {
                        model.transMat[i][j] /= rowSum;
                    }
                }
            }
            Serial.print(F("[STORAGE] Muat User Slot "));
            Serial.print(slotIndex);
            Serial.print(F(" ("));
            Serial.print(model.userName);
            Serial.println(F(") -> OK"));
            return model.isRegistered;
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
        // Res 0 = sukses terhapus, res < 0 = item memang tidak ada atau gagal
        return (res == 0 || res == MBED_ERROR_ITEM_NOT_FOUND);
    }

    // Menghapus seluruh profil pengguna
    static bool clearAllUsers() {
        bool allOk = true;
        for (uint8_t i = 0; i < MAX_USERS; ++i) {
            if (!deleteUser(i)) {
                allOk = false;
            }
        }
        return allOk;
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