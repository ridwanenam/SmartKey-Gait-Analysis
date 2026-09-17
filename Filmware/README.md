# Tugas Akhir: GAIT ANALYSIS

Sistem wearable berbasis Arduino Nano RP2040 Connect dan sensor inertial (LSM6DSOX) untuk mendeteksi gaya jalan.

### Node 1: Arduino Nano RP2040 Connect (Main Controller)

- **Tugas:** Sampling sensor, filtering, klasifikasi gaya jalan, dan manajemen BLE.
- **Folder:** `src/main.cpp`

### Node 2: ESP32 (Sensor/Data Collector)

- **Tugas:** Mengumpulkan raw data dari sensor lain.
- **Folder:** `src/esp32.cpp`

## 3\. Konfigurasi Build (`platformio.ini`)

```ini
[env:nanorp2040connect]
platform = raspberrypi
board = nanorp2040connect
framework = arduino
build_src_filter = -<*> +<nano/>

[env:esp32]
platform = espressif32
board = esp32doit-devkit-v1
framework = arduino
build_src_filter = -<*> +<esp/>
```