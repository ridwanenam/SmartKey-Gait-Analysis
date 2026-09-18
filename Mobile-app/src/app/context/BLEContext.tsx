import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect, useRef } from "react";
import { BleClient, dataViewToText, textToDataView } from "@capacitor-community/bluetooth-le";
import { databaseService } from "../services/databaseService";

// UUID BLE selaras dengan firmware RP2040 (Filmware/src/nano/config.h)
const SMART_KEY_SERVICE_UUID = "19b10000-e8f2-537e-4f6c-d104768a1214";
const DATA_CHARACTERISTIC_UUID = "19b10002-e8f2-537e-4f6c-d104768a1214"; // TX Telemetri dari RP2040 (Notifications)
const COMMAND_CHARACTERISTIC_UUID = "19b10001-e8f2-537e-4f6c-d104768a1214"; // RX Command ke RP2040 (Trigger/Write)
const DOOR_CHARACTERISTIC_UUID = "19b10003-e8f2-537e-4f6c-d104768a1214"; // TX Door Command dari RP2040 (Notifications)

export type BLEConnectionState = "disconnected" | "connecting" | "connected";

export interface LogEntry {
  id: string;
  type: "auth" | "reg" | "system";
  timestamp: string;
  status: "Success" | "Failed" | "Info" | "Warning" | "Error";
  message: string;
}

export interface BLETelemetry {
  windowIndex: number;
  isZUPTValid: boolean;
  confidenceScore: number;
  logLikelihood: number;
  mean: number;
  variance: number;
  stdDev: number;
  skewness: number;
  kurtosis: number;
  adaptiveThreshold: number;
  emaDelta: number;
  freq: string;
  sigma: string;
  zupt: string;
  ghmm: string;
  th: string;
  alpha: string;
  dw: string;
}

export interface BLEData {
  score: string;
  vector: string;
  cov: string;
  delta: string;
  progress: number; // 0 to 10
  authStatus: "idle" | "scanning" | "success" | "failed";
  telemetry: BLETelemetry;
}

interface BLEContextType {
  connectionState: BLEConnectionState;
  bleData: BLEData;
  logs: LogEntry[];
  connect: () => Promise<void>;
  disconnect: () => void;
  sendCommand: (cmd: string) => Promise<boolean>;
  addLog: (entry: Omit<LogEntry, "id" | "timestamp">) => void;
  resetBleData: () => void;
  setBleData: React.Dispatch<React.SetStateAction<BLEData>>;
}

const defaultBLEData: BLEData = {
  score: "-",
  vector: "-",
  cov: "-",
  delta: "-",
  progress: 0,
  authStatus: "idle",
  telemetry: {
    windowIndex: 0,
    isZUPTValid: false,
    confidenceScore: 0,
    logLikelihood: 0,
    mean: 0,
    variance: 0,
    stdDev: 0,
    skewness: 0,
    kurtosis: 0,
    adaptiveThreshold: 0,
    emaDelta: 0,
    freq: "100 Hz",
    sigma: "-",
    zupt: "-",
    ghmm: "-",
    th: "-",
    alpha: "-",
    dw: "-",
  }
};

const BLEContext = createContext<BLEContextType | null>(null);

export function useBLE() {
  const context = useContext(BLEContext);
  if (!context) {
    throw new Error("useBLE must be used within a BLEProvider");
  }
  return context;
}

export function BLEProvider({ children }: { children: ReactNode }) {
  const [connectionState, setConnectionState] = useState<BLEConnectionState>("disconnected");
  const [bleData, setBleData] = useState<BLEData>(defaultBLEData);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  const lastAuthStatus = useRef<string>("idle");
  const lastProgress = useRef<number>(0);
  const currentSessionSteps = useRef<Array<{
    step: number;
    time: string;
    hz: string;
    zupt: string;
    confidence: string;
    logLikelihood: string;
    mean: string;
    variance: string;
    stdDev: string;
    skewness: string;
    kurtosis: string;
    adaptiveThreshold: string;
    emaDelta: string;
    status: string;
  }>>([]);

  // Initialize and load system logs from database on startup
  useEffect(() => {
    databaseService.initialize().then(async () => {
      try {
        const sysLogs = await databaseService.getSystemLogs(20);
        if (sysLogs.length > 0) {
          setLogs(
            sysLogs.map((s) => ({
              id: s.id,
              type: "system",
              timestamp: s.timestamp,
              status: s.status as any,
              message: s.message,
            }))
          );
        }
      } catch (err) {
        console.error("Gagal membaca riwayat log awal", err);
      }
    });
  }, []);

  const addLog = useCallback((entry: Omit<LogEntry, "id" | "timestamp">) => {
    const timestamp = new Date().toLocaleTimeString("id-ID");
    const id = Math.random().toString(36).substring(2, 9);
    
    setLogs((prev) => [
      {
        ...entry,
        id,
        timestamp,
      },
      ...prev,
    ]);

    // Simpan ke SQLite Log Sistem
    databaseService.addSystemLog({
      timestamp,
      status: entry.status,
      message: entry.message,
    }).catch(console.error);
  }, []);

  const resetBleData = useCallback(() => {
    setBleData(defaultBLEData);
    lastProgress.current = 0;
    currentSessionSteps.current = [];
  }, []);

  const onDisconnected = useCallback((disconnectedDeviceId: string) => {
    setConnectionState("disconnected");
    setDeviceId(null);
    addLog({ type: "system", status: "Info", message: "Terputus dari Smart Key" });
  }, [addLog]);

  const handleDoorNotification = useCallback((value: DataView) => {
    try {
      const text = dataViewToText(value).trim();
      console.log("[BLE DOOR EVENT]", text);
      if (text === "OPEN_DOOR") {
        setBleData(prev => ({ ...prev, authStatus: "success" }));
        addLog({ type: "system", status: "Success", message: "Akses Diterima: Pintu Terbuka (OPEN_DOOR)" });
      } else if (text === "ACCESS_DENIED") {
        setBleData(prev => ({ ...prev, authStatus: "failed" }));
        addLog({ type: "system", status: "Failed", message: "Akses Ditolak: Pola Gait Tidak Cocok" });
      } else if (text === "CLOSE_DOOR") {
        addLog({ type: "system", status: "Info", message: "Pintu Terkunci (CLOSE_DOOR)" });
      } else if (text === "TRAIN_SUCCESS") {
        setBleData(prev => ({ ...prev, progress: 10, authStatus: "success" }));
        addLog({ type: "reg", status: "Success", message: "Pendaftaran Model Selesai di Edge RP2040" });
      }
    } catch (e) {
      console.error("Gagal memproses notifikasi door:", e);
    }
  }, [addLog]);

  const handleDataNotification = useCallback((value: DataView) => {
    try {
      const timestamp = new Date().toLocaleTimeString("id-ID");
      let windowIndex = 0;
      let zuptCode = 0;
      let isZUPTValid = false;
      let confidenceScore = 0;
      let logLikelihood = -145.0;
      let mean = 0.42;
      let variance = 1.15;
      let stdDev = 1.07;
      let skewness = -0.14;
      let kurtosis = 2.85;
      let adaptiveThreshold = -150.0;
      let emaDelta = 0.0;

      if (value.byteLength >= 18) {
        // Parsing Biner C-struct TelemetryData (little-endian)
        // Mendukung baik paket 20-byte (MTU 23) maupun 38-byte (MTU 247)
        windowIndex = value.getUint8(0);
        zuptCode = value.getUint8(1);
        isZUPTValid = (zuptCode === 1);
        confidenceScore = value.getFloat32(2, true);
        logLikelihood = value.getFloat32(6, true);
        mean = value.getFloat32(10, true);
        variance = value.getFloat32(14, true);

        stdDev = value.byteLength >= 22 ? value.getFloat32(18, true) : Math.sqrt(Math.max(0, variance));
        skewness = value.byteLength >= 26 ? value.getFloat32(22, true) : -0.14;
        kurtosis = value.byteLength >= 30 ? value.getFloat32(26, true) : 2.85;
        adaptiveThreshold = value.byteLength >= 34 ? value.getFloat32(30, true) : -150.0;
        emaDelta = value.byteLength >= 38 ? value.getFloat32(34, true) : 0.0;
      } else {
        // Fallback teks JSON jika dikirim lewat simulator
        try {
          const text = dataViewToText(value);
          const j = JSON.parse(text);
          windowIndex = j.progress ?? j.windowIndex ?? 0;
          confidenceScore = parseFloat(j.score ?? 0);
          isZUPTValid = j.isZUPTValid ?? true;
        } catch (_) {}
      }

      // Tentukan teks status ZUPT secara deskriptif untuk UI dan Log
      let zuptStatusStr = "Still (Discarded)";
      if (zuptCode === 2) {
        zuptStatusStr = `Kalibrasi Saku (${Math.round(confidenceScore)}s/5s)`;
      } else if (zuptCode === 3) {
        zuptStatusStr = "Kalibrasi Selesai (Siap Jalan)";
      } else if (isZUPTValid) {
        zuptStatusStr = "Valid (Active Gait)";
      }

      // Jaga agar progres tidak turun saat langkah diam terdeteksi
      if (windowIndex > lastProgress.current) {
        lastProgress.current = windowIndex;
      }
      const displayProgress = Math.max(windowIndex, lastProgress.current);

      // Catat rincian langkah aktif ke memori sesi jika ada langkah valid baru
      if (windowIndex > 0 && isZUPTValid) {
        const alreadyRecorded = currentSessionSteps.current.some(s => s.step === windowIndex);
        if (!alreadyRecorded) {
          currentSessionSteps.current.push({
            step: windowIndex,
            time: timestamp,
            hz: "100",
            zupt: "VALID (Walking)",
            confidence: confidenceScore.toFixed(1),
            logLikelihood: logLikelihood.toFixed(2),
            mean: mean.toFixed(3),
            variance: variance.toFixed(3),
            stdDev: stdDev.toFixed(3),
            skewness: skewness.toFixed(3),
            kurtosis: kurtosis.toFixed(3),
            adaptiveThreshold: adaptiveThreshold.toFixed(2),
            emaDelta: (emaDelta >= 0 ? "+" : "") + emaDelta.toFixed(3),
            status: confidenceScore >= 80.0 ? "VALID" : "PENDING",
          });
        }
      }

      const scoreStr = `${confidenceScore.toFixed(1)}%`;
      const vectorStr = `[${mean.toFixed(2)}, ${variance.toFixed(2)}, ${stdDev.toFixed(2)}]`;
      const covStr = `[${skewness.toFixed(2)}, ${kurtosis.toFixed(2)}]`;
      const deltaStr = (emaDelta >= 0 ? "+" : "") + emaDelta.toFixed(2);

      const authStatus = displayProgress >= 10
        ? (confidenceScore >= 80.0 ? "success" : "failed")
        : (displayProgress > 0 ? "scanning" : (zuptCode === 2 ? "scanning" : "idle"));

      const newBleData: BLEData = {
        score: scoreStr,
        vector: vectorStr,
        cov: covStr,
        delta: deltaStr,
        progress: displayProgress,
        authStatus,
        telemetry: {
          windowIndex: displayProgress,
          isZUPTValid,
          confidenceScore,
          logLikelihood,
          mean,
          variance,
          stdDev,
          skewness,
          kurtosis,
          adaptiveThreshold,
          emaDelta,
          freq: "100 Hz",
          sigma: variance.toFixed(3),
          zupt: zuptStatusStr,
          ghmm: logLikelihood.toFixed(2),
          th: adaptiveThreshold.toFixed(2),
          alpha: "0.15",
          dw: "3.0s (N=300)",
        }
      };

      setBleData(newBleData);

      // Simpan ke Log SQLite saat sesi selesai (10/10)
      if (displayProgress >= 10 && lastProgress.current !== 10) {
        lastProgress.current = 10;
        const finalDetails = JSON.stringify(currentSessionSteps.current);

        if (confidenceScore >= 80.0) {
          databaseService.addAuthLog({
            timestamp,
            userId: "Unit-A7 (Master)",
            score: scoreStr,
            status: "SUCCESS",
            incremental: `Adaptive (${deltaStr})`,
            message: "Verifikasi Gait Berhasil - Akses Terbuka",
            details: finalDetails,
          }).catch(console.error);
        } else {
          databaseService.addAuthLog({
            timestamp,
            userId: "Unknown / Rejected",
            score: scoreStr,
            status: "FAILED",
            incremental: "Rejected",
            message: "Pola Gait Tidak Sesuai Ambang CIR 80%",
            details: finalDetails,
          }).catch(console.error);
        }

        databaseService.addRegLog({
          timestamp,
          slotUser: "Slot 1 (User A7)",
          totalJendela: 10,
          statusAkhir: "SUCCESS",
          message: "Perekaman 10 Langkah Gait Sukses",
          details: finalDetails,
        }).catch(console.error);
      }
    } catch (err) {
      console.error("Gagal memproses data notifikasi BLE:", err);
    }
  }, []);

  const connect = async () => {
    try {
      setConnectionState("connecting");
      addLog({ type: "system", status: "Info", message: "Mencari Perangkat Bluetooth..." });
      
      await BleClient.initialize();

      const selectedDevice = await BleClient.requestDevice({
        services: [SMART_KEY_SERVICE_UUID],
      });
      
      addLog({ type: "system", status: "Info", message: "Menghubungkan ke Perangkat..." });
      await BleClient.connect(selectedDevice.deviceId, (id) => onDisconnected(id));
      
      // Setup Notifications untuk Telemetri Data
      await BleClient.startNotifications(
        selectedDevice.deviceId,
        SMART_KEY_SERVICE_UUID,
        DATA_CHARACTERISTIC_UUID,
        handleDataNotification
      );

      // Setup Notifications untuk Sinyal Kontrol Pintu (OPEN_DOOR / ACCESS_DENIED)
      try {
        await BleClient.startNotifications(
          selectedDevice.deviceId,
          SMART_KEY_SERVICE_UUID,
          DOOR_CHARACTERISTIC_UUID,
          handleDoorNotification
        );
      } catch (doorErr) {
        console.log("Door notification optional fallback:", doorErr);
      }
      
      setDeviceId(selectedDevice.deviceId);
      setConnectionState("connected");
      addLog({ type: "system", status: "Success", message: "Berhasil terhubung ke Smart Key" });
      
    } catch (error) {
      console.error(error);
      setConnectionState("disconnected");
      addLog({ type: "system", status: "Failed", message: `Koneksi gagal: ${(error as Error).message}` });
    }
  };

  const disconnect = useCallback(async () => {
    if (deviceId) {
      try {
        await BleClient.disconnect(deviceId);
      } catch (err) {
        console.error(err);
      }
    }
  }, [deviceId]);

  const sendCommand = async (cmd: string): Promise<boolean> => {
    if (!deviceId) {
      addLog({ type: "system", status: "Failed", message: "Perangkat tidak terhubung" });
      return false;
    }
    try {
      await BleClient.write(
        deviceId,
        SMART_KEY_SERVICE_UUID,
        COMMAND_CHARACTERISTIC_UUID,
        textToDataView(cmd)
      );
      addLog({ type: "system", status: "Success", message: `Perintah terkirim: ${cmd}` });
      return true;
    } catch (error) {
      console.error("Gagal mengirim perintah", error);
      addLog({ type: "system", status: "Failed", message: `Gagal mengirim: ${(error as Error).message}` });
      return false;
    }
  };

  return (
    <BLEContext.Provider value={{ connectionState, bleData, logs, connect, disconnect, sendCommand, addLog, resetBleData, setBleData }}>
      {children}
    </BLEContext.Provider>
  );
}
