#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ==============================================================================
// 1. KONFIGURASI PERANGKAT KERAS & PIN (DIAGRAM ESP32 -> RELAY -> SOLENOID)
// ==============================================================================
// Sesuai diagram pengkabelan:
// - ESP32 Pin 27 (GPIO16) -> Pin IN pada Modul Relay
// - Vin 5V                -> VCC Modul Relay
// - GND                   -> GND Modul Relay
// - Relay COM & NO        -> Mengontrol Arus DC 12V untuk Solenoid Door Lock
// ==============================================================================
constexpr uint8_t RELAY_PIN         = 16;   // GPIO16 terhubung ke pin IN Relay
constexpr uint8_t LED_INDICATOR     = 2;    // Built-in LED ESP32 (indikator visual status pintu)

// Level logika trigger relay:
// Standar modul relay 5V Arduino/ESP (seperti SRD-05VDC-SL-C) umumnya bertipe Active-LOW.
// Ubah ke HIGH jika modul relay Anda diset jumper-nya ke High-Level Trigger.
#define RELAY_ACTIVE_LEVEL          LOW
#define RELAY_INACTIVE_LEVEL        ((RELAY_ACTIVE_LEVEL == LOW) ? HIGH : LOW)

// Proteksi Solenoid:
// Solenoid 12V DC tidak boleh terus menerus dialiri listrik agar kumparannya tidak overheating/terbakar.
// Sistem akan mengunci kembali secara otomatis setelah durasi ini (Auto-Relock).
constexpr uint32_t UNLOCK_DURATION_MS = 5000; // 5 Detik

// ==============================================================================
// 2. KONFIGURASI PROTOKOL BLUETOOTH LOW ENERGY (BLE)
// ==============================================================================
#define BLE_DEVICE_NAME             "SmartKey_DoorLock"
#define DOOR_SERVICE_UUID           "19B10000-E8F2-537E-4F6C-D104768A1214"
#define DOOR_CHAR_UUID              "19B10003-E8F2-537E-4F6C-D104768A1214"

// ==============================================================================
// 3. VARIABEL GLOBAL & STATE MACHINE
// ==============================================================================
BLEServer* pServer = nullptr;
BLECharacteristic* pDoorChar = nullptr;
bool deviceConnected = false;
bool oldDeviceConnected = false;

bool isDoorUnlocked = false;
uint32_t unlockTimestamp = 0;

// ==============================================================================
// 4. LOGIKA KONTROL SOLENOID FISIK
// ==============================================================================
void lockDoor() {
    digitalWrite(RELAY_PIN, RELAY_INACTIVE_LEVEL);
    digitalWrite(LED_INDICATOR, LOW);
    isDoorUnlocked = false;

    if (pDoorChar) {
        pDoorChar->setValue("DOOR_LOCKED");
        if (deviceConnected) {
            pDoorChar->notify();
        }
    }
    Serial.println(F("[DOOR] >>> Solenoid Dinonaktifkan -> PINTU TERKUNCI (LOCKED) <<<"));
}

void unlockDoor(const char* reason = "COMMAND") {
    digitalWrite(RELAY_PIN, RELAY_ACTIVE_LEVEL);
    digitalWrite(LED_INDICATOR, HIGH);
    isDoorUnlocked = true;
    unlockTimestamp = millis();

    if (pDoorChar) {
        char statusMsg[48];
        snprintf(statusMsg, sizeof(statusMsg), "DOOR_UNLOCKED:%s", reason);
        pDoorChar->setValue(statusMsg);
        if (deviceConnected) {
            pDoorChar->notify();
        }
    }
    Serial.print(F("[DOOR] >>> Solenoid Diberi Daya -> PINTU TERBUKA (UNLOCKED) ["));
    Serial.print(reason);
    Serial.println(F("] <<<"));
    Serial.println(F("[SAFETY] Timer Auto-Relock berjalan: Pintu akan terkunci otomatis dlm 5 detik."));
}

void processCommand(const char* cmd) {
    if (!cmd || strlen(cmd) == 0) return;

    Serial.print(F("[CMD] Perintah Masuk: "));
    Serial.println(cmd);

    // 1. Perintah Membuka Pintu (Bisa dari Verifikasi Gait RP2040, Mobile App, atau Serial)
    if (strncmp(cmd, "OPEN_DOOR", 9) == 0 || 
        strcasecmp(cmd, "OPEN") == 0 || 
        strcasecmp(cmd, "UNLOCK") == 0 || 
        strcmp(cmd, "1") == 0) {
        
        const char* reason = "VERIFIED";
        if (strncmp(cmd, "OPEN_DOOR:", 10) == 0) {
            reason = cmd + 10; // Mengambil nama user atau "PIN_BYPASS"
        }
        unlockDoor(reason);
    }
    // 2. Perintah Mengunci Pintu Manual
    else if (strcasecmp(cmd, "CLOSE_DOOR") == 0 || 
             strcasecmp(cmd, "LOCK_DOOR") == 0 || 
             strcasecmp(cmd, "LOCK") == 0 || 
             strcasecmp(cmd, "CLOSE") == 0 || 
             strcmp(cmd, "0") == 0) {
        lockDoor();
    }
    // 3. Permintaan Cek Status Pintu
    else if (strcasecmp(cmd, "STATUS") == 0) {
        if (pDoorChar) {
            pDoorChar->setValue(isDoorUnlocked ? "DOOR_UNLOCKED" : "DOOR_LOCKED");
            if (deviceConnected) {
                pDoorChar->notify();
            }
        }
        Serial.print(F("[STATUS] Status Pintu Saat Ini: "));
        Serial.println(isDoorUnlocked ? F("UNLOCKED") : F("LOCKED"));
    }
    else {
        Serial.print(F("[CMD] Perintah Tidak Dikenal: "));
        Serial.println(cmd);
    }
}

// ==============================================================================
// 5. CALLBACK BLE SERVER & KARAKTERISTIK
// ==============================================================================
class DoorServerCallbacks : public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) override {
        deviceConnected = true;
        Serial.println(F("\n[BLE] Perangkat Client Terhubung!"));
    }

    void onDisconnect(BLEServer* pServer) override {
        deviceConnected = false;
        Serial.println(F("[BLE] Perangkat Client Terputus."));
        // Failsafe: Pastikan pintu terkunci jika koneksi putus
        if (isDoorUnlocked) {
            lockDoor();
            Serial.println(F("[FAILSAFE] Client disconnect saat pintu terbuka -> Mengunci otomatis."));
        }
    }
};

class DoorCharCallbacks : public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic* pCharacteristic) override {
        std::string rxValue = pCharacteristic->getValue();
        if (rxValue.length() > 0) {
            processCommand(rxValue.c_str());
        }
    }
};

// ==============================================================================
// 6. SETUP PROGRAM
// ==============================================================================
void setup() {
    Serial.begin(115200);
    delay(1000);

    Serial.println(F("=================================================="));
    Serial.println(F("   SMARTKEY GAIT ANALYSIS - ESP32 DOOR RECEIVER   "));
    Serial.println(F("=================================================="));

    // 1. Inisialisasi GPIO Hardware
    pinMode(RELAY_PIN, OUTPUT);
    pinMode(LED_INDICATOR, OUTPUT);

    // Failsafe Awal: Selalu pastikan solenoid dalam keadaan TERKUNCI saat boot
    digitalWrite(RELAY_PIN, RELAY_INACTIVE_LEVEL);
    digitalWrite(LED_INDICATOR, LOW);
    isDoorUnlocked = false;

    Serial.print(F("[HARDWARE] Relay Solenoid diinisialisasi pada GPIO"));
    Serial.println(RELAY_PIN);
    Serial.println(F("[HARDWARE] Status Awal: LOCKED (Failsafe Terkunci)"));

    // 2. Inisialisasi BLE Device & GATT Server
    Serial.println(F("[BLE] Menginisialisasi BLE Server..."));
    BLEDevice::init(BLE_DEVICE_NAME);

    pServer = BLEDevice::createServer();
    pServer->setCallbacks(new DoorServerCallbacks());

    // 3. Membuat GATT Service & Karakteristik Kontrol Pintu
    BLEService* pService = pServer->createService(DOOR_SERVICE_UUID);

    pDoorChar = pService->createCharacteristic(
        DOOR_CHAR_UUID,
        BLECharacteristic::PROPERTY_READ   |
        BLECharacteristic::PROPERTY_WRITE  |
        BLECharacteristic::PROPERTY_WRITE_NR |
        BLECharacteristic::PROPERTY_NOTIFY
    );

    pDoorChar->setCallbacks(new DoorCharCallbacks());
    pDoorChar->addDescriptor(new BLE2902());
    pDoorChar->setValue("DOOR_LOCKED");

    pService->start();

    // 4. Memulai BLE Advertising
    BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(DOOR_SERVICE_UUID);
    pAdvertising->setScanResponse(true);
    pAdvertising->setMinPreferred(0x06); // Bantuan stabilitas koneksi iOS/Android
    pAdvertising->setMinPreferred(0x12);
    BLEDevice::startAdvertising();

    Serial.print(F("[BLE] Siap! Advertising sebagai: "));
    Serial.println(F(BLE_DEVICE_NAME));
    Serial.println(F("[INFO] Anda dapat mengirim '1' atau 'OPEN' via Serial Monitor untuk tes!"));
    Serial.println(F("--------------------------------------------------"));
}

// ==============================================================================
// 7. LOOP PROGRAM UTAMA
// ==============================================================================
void loop() {
    // 1. Auto-Relock Timer (Non-blocking):
    // Melindungi koil solenoid 12V dari panas berlebih
    if (isDoorUnlocked) {
        if (millis() - unlockTimestamp >= UNLOCK_DURATION_MS) {
            lockDoor();
            Serial.println(F("[SAFETY] Waktu buka selesai (5 detik). Solenoid dinonaktifkan (Auto-Relocked)."));
        }
    }

    // 2. Manajemen Koneksi Ulang BLE Advertising
    if (!deviceConnected && oldDeviceConnected) {
        delay(500); // Beri jeda agar stack Bluetooth stabil
        pServer->startAdvertising();
        Serial.println(F("[BLE] Menyiapkan kembali advertising untuk perangkat berikutnya..."));
        oldDeviceConnected = deviceConnected;
    }
    if (deviceConnected && !oldDeviceConnected) {
        oldDeviceConnected = deviceConnected;
    }

    // 3. Serial Monitor Control (Memudahkan pengujian kabel & relay tanpa HP)
    if (Serial.available()) {
        String serialCmd = Serial.readStringUntil('\n');
        serialCmd.trim();
        if (serialCmd.length() > 0) {
            processCommand(serialCmd.c_str());
        }
    }

    delay(20); // Efisiensi CPU ESP32
}
