#ifndef STORAGE_MANAGER_H
#define STORAGE_MANAGER_H

#include <Arduino.h>
#include <KVStore.h>
#include <kvstore_global_api.h>
#include <mbed_error.h>
#include "Config.h"

// Format lama untuk kompatibilitas data transisi per-slot di Flash
struct UserModelOld {
    bool isRegistered;
    char userName[16];
    float startProb[NUM_STATES];
    float transMat[NUM_STATES][NUM_STATES];
    float means[NUM_STATES][NUM_FEATURES];
    float covars[NUM_STATES][NUM_FEATURES];
    float baselineLogProb;
};

// Struktur database terpadu seluruh slot pengguna.
// Disimpan dalam 1 key tunggal "/kv/users" (~872 bytes) sehingga kuota Flash TDBStore
// SELALU konstan dan tidak pernah melebihi kapasitas sektor (3584 bytes)
// terlepas dari apakah terisi 1, 4, 5, atau 6 slot.
constexpr uint32_t DB_MAGIC = 0x47414954; // 'GAIT'
constexpr const char *DB_KEY = "/kv/users";

struct UserDatabase {
    uint32_t magic;      // 0x47414954 "GAIT"
    uint16_t version;    // 1
    uint16_t maxSlots;   // MAX_USERS (6)
    UserModel users[MAX_USERS];
};

class StorageManager {
public:
    static void begin() {
        Serial.println(F("[STORAGE] Mbed KVStore Flash Siap (Unified DB Mode)"));
    }

    // Menyimpan seluruh profil pengguna ke dalam 1 record database terpadu di Flash
    static bool saveAll(const UserModel users[MAX_USERS]) {
        UserDatabase db;
        memset(&db, 0, sizeof(UserDatabase));
        db.magic = DB_MAGIC;
        db.version = 1;
        db.maxSlots = MAX_USERS;

        for (uint8_t i = 0; i < MAX_USERS; ++i) {
            db.users[i] = users[i];
        }

        int res = kv_set(DB_KEY, &db, sizeof(UserDatabase), 0);
        Serial.print(F("[STORAGE] Simpan UserDatabase ("));
        Serial.print(sizeof(UserDatabase));
        Serial.print(F(" B) -> res: "));
        Serial.println(res);

        // Jika kv_set gagal (misal partisi Flash penuh akibat sisa fragmented tombstone lama),
        // lakukan reset partisi bersih lalu simpan ulang
        if (res != 0) {
            Serial.println(F("[STORAGE ERROR] kv_set gagal, melakukan auto-recovery kv_reset & tulis ulang..."));
            kv_reset("/kv/");
            res = kv_set(DB_KEY, &db, sizeof(UserDatabase), 0);
            Serial.print(F("[STORAGE] Recovery kv_set res: "));
            Serial.println(res);
        }

        return (res == 0);
    }

    // Memuat seluruh profil pengguna dari Flash ke RAM dengan auto-migrasi dari key individu lama
    static bool loadAll(UserModel users[MAX_USERS]) {
        UserDatabase db;
        size_t actualSize = 0;
        int res = kv_get(DB_KEY, &db, sizeof(UserDatabase), &actualSize);

        if (res == 0 && actualSize == sizeof(UserDatabase) && db.magic == DB_MAGIC) {
            for (uint8_t i = 0; i < MAX_USERS; ++i) {
                users[i] = db.users[i];
            }
            Serial.println(F("[STORAGE] UserDatabase terpadu berhasil dimuat dari Flash!"));
            return true;
        }

        // Jika DB_KEY belum ditemukan, lakukan migrasi transparan dari key lama (/kv/usr_0 s.d. /kv/usr_5)
        Serial.println(F("[STORAGE] DB_KEY belum ada, memeriksa key slot individu lama..."));
        bool foundAny = false;
        for (uint8_t i = 0; i < MAX_USERS; ++i) {
            char key[16];
            snprintf(key, sizeof(key), "/kv/usr_%d", i);

            uint8_t buf[sizeof(UserModel)];
            size_t sz = 0;
            int kRes = kv_get(key, buf, sizeof(buf), &sz);

            if (kRes == 0) {
                if (sz == sizeof(UserModel)) {
                    memcpy(&users[i], buf, sizeof(UserModel));
                    if (users[i].isRegistered) foundAny = true;
                } else if (sz == sizeof(UserModelOld)) {
                    UserModelOld oldModel;
                    memcpy(&oldModel, buf, sizeof(UserModelOld));
                    memset(&users[i], 0, sizeof(UserModel));
                    users[i].isRegistered = oldModel.isRegistered;
                    strncpy(users[i].userName, oldModel.userName, sizeof(users[i].userName) - 1);
                    users[i].userName[sizeof(users[i].userName) - 1] = '\0';
                    for (uint8_t s = 0; s < NUM_STATES; ++s) {
                        users[i].startProb[s] = oldModel.startProb[s];
                        for (uint8_t j = 0; j < NUM_STATES; ++j) {
                            users[i].transMat[s][j] = oldModel.transMat[s][j];
                        }
                        for (uint8_t f = 0; f < NUM_FEATURES; ++f) {
                            users[i].means[s][f] = oldModel.means[s][f];
                            users[i].covars[s][f] = oldModel.covars[s][f];
                        }
                    }
                    users[i].baselineLogProb = oldModel.baselineLogProb;
                    if (users[i].isRegistered) foundAny = true;
                }
            } else {
                users[i].isRegistered = false;
                memset(&users[i], 0, sizeof(UserModel));
            }
        }

        if (foundAny) {
            Serial.println(F("[STORAGE] Migrasi data lama ke UserDatabase terpadu..."));
            saveAll(users);
            // Bersihkan key lama agar menghemat ruang Flash
            for (uint8_t i = 0; i < MAX_USERS; ++i) {
                char key[16];
                snprintf(key, sizeof(key), "/kv/usr_%d", i);
                kv_remove(key);
            }
            return true;
        }

        // Jika memang belum ada profil sama sekali
        for (uint8_t i = 0; i < MAX_USERS; ++i) {
            users[i].isRegistered = false;
            memset(&users[i], 0, sizeof(UserModel));
        }
        return false;
    }

    // Menghapus seluruh profil pengguna dan memformat partisi Flash secara bersih
    static bool clearAllUsers() {
        int res = kv_reset("/kv/");
        Serial.print(F("[STORAGE] clearAllUsers (kv_reset) res: "));
        Serial.println(res);
        return (res == 0);
    }
};

#endif // STORAGE_MANAGER_H
