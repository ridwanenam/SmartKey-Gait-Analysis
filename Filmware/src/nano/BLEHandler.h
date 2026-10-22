#ifndef BLE_HANDLER_H
#define BLE_HANDLER_H

#include <Arduino.h>
#include <ArduinoBLE.h>
#include "Config.h"

class BLEHandler {
private:
    BLEService gaitService;
    BLECharacteristic rxCmdChar;
    BLECharacteristic txTelemetryChar;
    BLECharacteristic txDoorChar;
    BLECharacteristic txLiveChar;

    char lastReceivedCommand[64];
    bool newCommandAvailable;

public:
    BLEHandler() 
        : gaitService(BLE_SERVICE_UUID),
          rxCmdChar(BLE_CHAR_RX_CMD_UUID, BLEWrite | BLEWriteWithoutResponse, 64),
          txTelemetryChar(BLE_CHAR_TX_TELEMETRY_UUID, BLERead | BLENotify, sizeof(TelemetryData)),
          txDoorChar(BLE_CHAR_TX_DOOR_UUID, BLERead | BLENotify, 64),
          txLiveChar(BLE_CHAR_TX_LIVE_UUID, BLERead | BLENotify, sizeof(LiveSampleData)),
          newCommandAvailable(false) {
        memset(lastReceivedCommand, 0, sizeof(lastReceivedCommand));
    }

    static void onBleDisconnected(BLEDevice central) {
        Serial.print(F("[BLE] Terputus dari Ponsel: "));
        Serial.println(central.address());
        BLE.advertise();
        Serial.println(F("[BLE] Auto Re-Advertising Dinyalakan Kembali"));
    }

    // Inisialisasi GATT Server & Karakteristik BLE
    bool begin() {
        if (!BLE.begin()) {
            return false;
        }

        BLE.setLocalName(BLE_DEVICE_NAME);
        BLE.setDeviceName(BLE_DEVICE_NAME);
        BLE.setAdvertisedService(gaitService);

        // Pasang karakteristik ke dalam GATT Service
        gaitService.addCharacteristic(rxCmdChar);
        gaitService.addCharacteristic(txTelemetryChar);
        gaitService.addCharacteristic(txDoorChar);
        gaitService.addCharacteristic(txLiveChar);

        BLE.addService(gaitService);

        // Daftarkan event listener agar otomatis advertise ulang saat ponsel terputus
        BLE.setEventHandler(BLEDisconnected, onBleDisconnected);

        BLE.advertise();

        return true;
    }

    // Melakukan polling event BLE secara non-blocking
    void poll() {
        BLE.poll();

        // Penjaga Auto-Advertising: Pastikan beacon BLE tetap mengudara saat belum terhubung
        if (!BLE.connected()) {
            static unsigned long lastAdvCheck = 0;
            unsigned long now = millis();
            if (now - lastAdvCheck >= 3000) {
                lastAdvCheck = now;
                BLE.advertise();
            }
        }

        // Cek apakah ada string perintah masuk dari Mobile App
        if (rxCmdChar.written()) {
            int len = rxCmdChar.valueLength();
            if (len > 0 && len < 64) {
                memcpy(lastReceivedCommand, rxCmdChar.value(), len);
                lastReceivedCommand[len] = '\0';
                newCommandAvailable = true;
            }
        }
    }

    // Memeriksa keberadaan perintah baru dari Mobile App
    bool hasNewCommand(char *commandBuffer, size_t maxLen) {
        if (newCommandAvailable) {
            strncpy(commandBuffer, lastReceivedCommand, maxLen - 1);
            commandBuffer[maxLen - 1] = '\0';
            newCommandAvailable = false;
            return true;
        }
        return false;
    }

    // Mengirim struct telemetri berkala (per jendela 1.5 detik) ke Mobile App
    void sendTelemetry(const TelemetryData &data) {
        if (BLE.connected()) {
            txTelemetryChar.writeValue((const uint8_t *)&data, sizeof(TelemetryData));
        }
    }

    // Mengirim sampel gelombang real-time 20 Hz ke Mobile App (Pure Real Data)
    void sendLiveSample(const LiveSampleData &data) {
        if (BLE.connected()) {
            txLiveChar.writeValue((const uint8_t *)&data, sizeof(LiveSampleData));
        }
    }

    // Menembakkan string otorisasi ke ESP32 Door Node (Asynchronous State-Caching)
    void sendDoorCommand(const char *command) {
        if (BLE.connected()) {
            txDoorChar.writeValue((const uint8_t *)command, strlen(command));
        }
    }

    bool isConnected() const {
        return BLE.connected();
    }
};

#endif // BLE_HANDLER_H