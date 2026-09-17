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

        int res = kv_set(key, &model, sizeof(UserModel), 0);
        return (res == 0); // 0 menandakan operasi sukses pada Mbed KVStore
    }

    // Membaca model pengguna dari Flash ke RAM
    static bool loadUser(uint8_t slotIndex, UserModel &model) {
        if (slotIndex >= MAX_USERS) return false;

        char key[16];
        getUserKey(slotIndex, key, sizeof(key));

        size_t actualSize = 0;
        int res = kv_get(key, &model, sizeof(UserModel), &actualSize);

        if (res == 0 && actualSize == sizeof(UserModel)) {
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