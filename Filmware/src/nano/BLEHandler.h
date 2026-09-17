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

    char lastReceivedCommand[32];
    bool newCommandAvailable;

public:
    BLEHandler() 
        : gaitService(BLE_SERVICE_UUID),
          rxCmdChar(BLE_CHAR_RX_CMD_UUID, BLEWrite | BLEWriteWithoutResponse, 32),
          txTelemetryChar(BLE_CHAR_TX_TELEMETRY_UUID, BLERead | BLENotify, sizeof(TelemetryData)),
          txDoorChar(BLE_CHAR_TX_DOOR_UUID, BLERead | BLENotify, 32),
          newCommandAvailable(false) {
        memset(lastReceivedCommand, 0, sizeof(lastReceivedCommand));
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

        BLE.addService(gaitService);
        BLE.advertise();

        return true;
    }

    // Melakukan polling event BLE secara non-blocking
    void poll() {
        BLE.poll();

        // Cek apakah ada string perintah masuk dari Mobile App
        if (rxCmdChar.written()) {
            int len = rxCmdChar.valueLength();
            if (len > 0 && len < 32) {
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

    // Mengirim struct telemetri berkala (per jendela 3 detik) ke Mobile App
    void sendTelemetry(const TelemetryData &data) {
        if (BLE.connected()) {
            txTelemetryChar.writeValue((const uint8_t *)&data, sizeof(TelemetryData));
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