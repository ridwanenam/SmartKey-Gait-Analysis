#include <Arduino.h>

constexpr uint8_t RELAY_PIN = 15; // Pin D15 ESP32 ke pin IN Relay
constexpr uint8_t LED_PIN   = 2;  // Built-in LED ESP32 sebagai indikator visual

void setup() {
    Serial.begin(115200);
    pinMode(RELAY_PIN, OUTPUT);
    pinMode(LED_PIN, OUTPUT);

    // Set awal terkunci (mati)
    digitalWrite(RELAY_PIN, LOW);
    digitalWrite(LED_PIN, LOW);

    Serial.println(F("--- Pengujian Solenoid & Relay Dimulai ---"));
    delay(1000);
}

void loop() {
    // 1. Solenoid Diberi Daya (Membuka)
    Serial.println(F("[STATUS] Relay ON -> Solenoid TERBUKA (3 Detik)"));
    digitalWrite(RELAY_PIN, HIGH);
    digitalWrite(LED_PIN, HIGH);
    delay(3000);

    // 2. Solenoid Dimatikan (Mengunci)
    Serial.println(F("[STATUS] Relay OFF -> Solenoid TERKUNCI (3 Detik)"));
    digitalWrite(RELAY_PIN, LOW);
    digitalWrite(LED_PIN, LOW);
    delay(3000);
}