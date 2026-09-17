import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect, useRef } from "react";
import { BleClient, dataViewToText, textToDataView } from "@capacitor-community/bluetooth-le";
import { databaseService } from "../services/databaseService";

// Placeholder UUIDs for the Smart Home Security App
const SMART_KEY_SERVICE_UUID = "12345678-1234-5678-1234-56789abcdef0";
const DATA_CHARACTERISTIC_UUID = "12345678-1234-5678-1234-56789abcdef1"; // Notifications (Confidence, Vector, Progress, etc)
const COMMAND_CHARACTERISTIC_UUID = "12345678-1234-5678-1234-56789abcdef2"; // Write commands (Lock, Emergency PIN)

export type BLEConnectionState = "disconnected" | "connecting" | "connected";

export interface LogEntry {
  id: string;
  type: "auth" | "reg" | "system";
  timestamp: string;
  status: "Success" | "Failed" | "Info";
  message: string;
}

export interface BLEData {
  score: string;
  vector: string;
  cov: string;
  delta: string;
  progress: number; // 0 to 10
  authStatus: "idle" | "scanning" | "success" | "failed";
  telemetry: {
    sigma: string;
    zupt: string;
    ghmm: string;
    th: string;
    alpha: string;
    dw: string;
    freq: string;
  };
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
    sigma: "-",
    zupt: "-",
    ghmm: "-",
    th: "-",
    alpha: "-",
    dw: "-",
    freq: "-"
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
  const lastTelemetrySave = useRef<number>(0);

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
  }, []);

  const onDisconnected = useCallback((disconnectedDeviceId: string) => {
    setConnectionState("disconnected");
    setDeviceId(null);
    addLog({ type: "system", status: "Info", message: "Terputus dari Smart Key" });
  }, [addLog]);

  const handleDataNotification = useCallback((value: DataView) => {
    try {
      const text = dataViewToText(value);
      const data = JSON.parse(text) as Partial<BLEData>;
      const timestamp = new Date().toLocaleTimeString("id-ID");

      // 1. Simpan ke Log Autentikasi jika status autentikasi berubah ke success/failed
      if (data.authStatus && data.authStatus !== "idle" && data.authStatus !== lastAuthStatus.current) {
        lastAuthStatus.current = data.authStatus;
        if (data.authStatus === "success") {
          databaseService.addAuthLog({
            timestamp,
            userId: "Unit-A7 (Master)",
            score: data.score || "0.98",
            status: "SUCCESS",
            incremental: "Adaptive",
            message: "Verifikasi Gait Berhasil - Akses Terbuka",
          }).catch(console.error);
        } else if (data.authStatus === "failed") {
          databaseService.addAuthLog({
            timestamp,
            userId: "Unknown / Tamper",
            score: data.score || "0.42",
            status: "FAILED",
            incremental: "Rejected",
            message: "Pola Gait Tidak Sesuai - Akses Ditolak",
          }).catch(console.error);
        }
      }

      // 2. Simpan ke Log Registrasi jika progress bertambah atau selesai
      if (typeof data.progress === "number" && data.progress !== lastProgress.current) {
        lastProgress.current = data.progress;
        if (data.progress === 10) {
          databaseService.addRegLog({
            timestamp,
            slotUser: "Slot 1 (User A7)",
            totalJendela: 10,
            statusAkhir: "SUCCESS",
            message: "Perekaman 10 Jendela Langkah Selesai",
          }).catch(console.error);
        }
      }

      // 3. Simpan ke Log Debug ML (dibatasi interval 3 detik agar tidak membebani memori)
      const now = Date.now();
      if (data.telemetry && now - lastTelemetrySave.current > 3000) {
        lastTelemetrySave.current = now;
        databaseService.addDebugMLLog({
          timestamp,
          vector: data.vector || "[0,0,0]",
          sigma: data.telemetry.sigma || "-",
          zupt: data.telemetry.zupt || "-",
          ghmm: data.telemetry.ghmm || "-",
          th: data.telemetry.th || "-",
          alpha: data.telemetry.alpha || "-",
          dw: data.telemetry.dw || "-",
          freq: data.telemetry.freq || "-",
        }).catch(console.error);
      }

      setBleData((prev) => ({ ...prev, ...data }));
    } catch (err) {
      console.error("Gagal memparsing data BLE", err);
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
      
      // Setup Notifications
      await BleClient.startNotifications(
        selectedDevice.deviceId,
        SMART_KEY_SERVICE_UUID,
        DATA_CHARACTERISTIC_UUID,
        handleDataNotification
      );
      
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
