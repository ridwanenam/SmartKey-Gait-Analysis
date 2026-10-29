import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect, useRef } from "react";
import { BleClient, dataViewToText, textToDataView } from "@capacitor-community/bluetooth-le";
import { databaseService, formatLogTimestamp } from "../services/databaseService";

// UUID BLE selaras dengan firmware RP2040 & ESP32
const SMART_KEY_SERVICE_UUID = "19b10000-e8f2-537e-4f6c-d104768a1214";
const COMMAND_CHARACTERISTIC_UUID = "19b10001-e8f2-537e-4f6c-d104768a1214"; // RX Command ke RP2040 (Trigger/Write)
const DATA_CHARACTERISTIC_UUID = "19b10002-e8f2-537e-4f6c-d104768a1214"; // TX Telemetri dari RP2040 (Notifications)
const DOOR_CHARACTERISTIC_UUID = "19b10003-e8f2-537e-4f6c-d104768a1214"; // TX Door Notification & RX Solenoid Trigger (ESP32 / RP2040)
const LIVE_CHARACTERISTIC_UUID = "19b10004-e8f2-537e-4f6c-d104768a1214"; // TX Live 20 Hz Waveform dari RP2040 (Notifications)

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

export interface LiveSample {
  liveVal: number;
  energy: number;
  isMoving: boolean;
  timestamp: number;
}

export interface BLEData {
  score: string;
  vector: string;
  cov: string;
  delta: string;
  progress: number; // 0 to 5
  authStatus: "idle" | "scanning" | "success" | "failed";
  telemetry: BLETelemetry;
}

interface BLEContextType {
  // Backward compatibility: connectionState mencerminkan status Wearable
  connectionState: BLEConnectionState;
  
  // Status koneksi dual-BLE mandiri
  wearableState: BLEConnectionState;
  doorLockState: BLEConnectionState;
  wearableDeviceId: string | null;
  doorLockDeviceId: string | null;

  // Status fisik solenoid pintu (dari ESP32)
  isDoorUnlocked: boolean;

  bleData: BLEData;
  liveSample: LiveSample | null;
  logs: LogEntry[];

  // Fungsi koneksi & diskoneksi
  connect: () => Promise<void>;
  connectWearable: () => Promise<void>;
  connectDoorLock: () => Promise<void>;
  autoConnect: () => Promise<void>;
  disconnect: () => void;
  disconnectWearable: () => void;
  disconnectDoorLock: () => void;

  // Kontrol perintah
  sendCommand: (cmd: string) => Promise<boolean>;
  sendDoorCommand: (cmd: string) => Promise<boolean>;

  addLog: (entry: Omit<LogEntry, "id" | "timestamp">) => void;
  resetBleData: () => void;
  setBleData: React.Dispatch<React.SetStateAction<BLEData>>;
  setActiveSession: (info: { mode: "auth" | "training" | null; slot: number; name: string }) => void;
  recordStepTelemetry: (stepItem: any) => void;
  verifiedUserName: string | null;
  syncFlashUsers: () => Promise<boolean>;
  deleteFlashUser: (slot: number) => Promise<boolean>;
  formatFlashMemory: () => Promise<boolean>;
  flashSyncVersion: number;
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
  // Dual BLE Connection States
  const [wearableState, setWearableState] = useState<BLEConnectionState>("disconnected");
  const [doorLockState, setDoorLockState] = useState<BLEConnectionState>("disconnected");
  const [wearableDeviceId, setWearableDeviceId] = useState<string | null>(null);
  const [doorLockDeviceId, setDoorLockDeviceId] = useState<string | null>(null);

  // References untuk pembacaan instan di dalam callbacks tanpa stale closures
  const wearableDeviceIdRef = useRef<string | null>(null);
  const doorLockDeviceIdRef = useRef<string | null>(null);
  const wearableStateRef = useRef<BLEConnectionState>("disconnected");
  const doorLockStateRef = useRef<BLEConnectionState>("disconnected");

  // Status Solenoid Pintu Fisik
  const [isDoorUnlocked, setIsDoorUnlocked] = useState<boolean>(false);

  const [bleData, setBleData] = useState<BLEData>(defaultBLEData);
  const [liveSample, setLiveSample] = useState<LiveSample | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const [verifiedUserName, setVerifiedUserName] = useState<string | null>(null);
  const verifiedUserNameRef = useRef<string | null>(null);
  const [flashSyncVersion, setFlashSyncVersion] = useState<number>(0);
  const sessionLogged = useRef<boolean>(false);
  const activeSessionInfo = useRef<{ mode: "auth" | "training" | null; slot: number; name: string }>({
    mode: null,
    slot: 0,
    name: "User 1",
  });

  const lastAuthStatus = useRef<string>("idle");
  const lastProgress = useRef<number>(0);
  const sessionStartTime = useRef<number>(0);

  // Status & Timer Auto-Reconnect Cerdas Dual BLE
  const manualDisconnectWearableRef = useRef<boolean>(false);
  const manualDisconnectDoorLockRef = useRef<boolean>(false);
  const isAutoConnectingRef = useRef<boolean>(false);
  const autoConnectTimerRef = useRef<any>(null);
  const autoConnectRef = useRef<() => Promise<void>>(async () => {});

  const currentSessionWaveform = useRef<Array<{
    t: number;
    val: number;
    energy: number;
    isMoving: boolean;
  }>>([]);
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
  const latestAuthScoresRef = useRef<Array<{ slot: number; score: number }>>([]);
  const latestGatesRef = useRef<{
    normJerk: number;
    asym: number;
    excursion: number;
    crestFactor: number;
    axisDominance: number;
    deltaGyro: number;
  } | null>(null);
  const latestTelemetryRef = useRef<BLETelemetry>(defaultBLEData.telemetry);

  // Selaraskan state refs
  useEffect(() => {
    wearableStateRef.current = wearableState;
  }, [wearableState]);

  useEffect(() => {
    doorLockStateRef.current = doorLockState;
  }, [doorLockState]);

  const setActiveSession = useCallback((info: { mode: "auth" | "training" | null; slot: number; name: string }) => {
    activeSessionInfo.current = info;
    sessionLogged.current = false;
    sessionStartTime.current = info.mode ? Date.now() : 0;
    currentSessionSteps.current = [];
    currentSessionWaveform.current = [];
    latestAuthScoresRef.current = [];
    latestGatesRef.current = null;
    lastProgress.current = 0;
    verifiedUserNameRef.current = null;
    setVerifiedUserName(null);
  }, []);

  const recordStepTelemetry = useCallback((stepItem: any) => {
    const alreadyRecorded = currentSessionSteps.current.some(s => s.step === stepItem.step);
    if (!alreadyRecorded) {
      currentSessionSteps.current.push(stepItem);
    }
  }, []);

  // Inisialisasi awal log sistem dari database SQLite
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
    const timestamp = formatLogTimestamp();
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
    sessionLogged.current = false;
    verifiedUserNameRef.current = null;
    latestAuthScoresRef.current = [];
    latestGatesRef.current = null;
    latestTelemetryRef.current = defaultBLEData.telemetry;
    setVerifiedUserName(null);
    currentSessionSteps.current = [];
  }, []);

  const logAuthSession = useCallback((decision: "SUCCESS" | "FAILED", userName?: string) => {
    if (sessionLogged.current || activeSessionInfo.current.mode !== "auth") return;
    sessionLogged.current = true;

    const timestamp = formatLogTimestamp();
    const durationSec = sessionStartTime.current > 0
      ? parseFloat(((Date.now() - sessionStartTime.current) / 1000).toFixed(1))
      : 7.5;
    const t = latestTelemetryRef.current;

    const maxCandidateScore = latestAuthScoresRef.current.length > 0
      ? Math.max(...latestAuthScoresRef.current.map(s => s.score))
      : (t.confidenceScore || 0);
    const scoreVal = maxCandidateScore;
    const scoreStr = `${scoreVal.toFixed(1)}%`;
    const deltaStr = (t.emaDelta !== undefined && t.emaDelta >= 0 ? "+" : "") + (t.emaDelta || 0).toFixed(2);

    const resolvedUser = decision === "SUCCESS"
      ? (userName || verifiedUserNameRef.current || "User")
      : "Unknown / Rejected";

    const finalDetails = JSON.stringify({
      version: 2,
      mode: "auth",
      targetUser: resolvedUser,
      scoresBreakdown: latestAuthScoresRef.current,
      gates: latestGatesRef.current,
      summary: {
        totalWindows: Math.max(lastProgress.current || 5, currentSessionSteps.current.length, 5),
        confidenceScore: parseFloat(scoreVal.toFixed(1)),
        logLikelihood: parseFloat((t.logLikelihood || 0).toFixed(2)),
        mean: parseFloat((t.mean || 0).toFixed(3)),
        variance: parseFloat((t.variance || 0).toFixed(3)),
        stdDev: parseFloat((t.stdDev || 0).toFixed(3)),
        skewness: parseFloat((t.skewness || 0).toFixed(3)),
        kurtosis: parseFloat((t.kurtosis || 0).toFixed(3)),
        adaptiveThreshold: parseFloat((t.adaptiveThreshold || 0).toFixed(2)),
        emaDelta: parseFloat((t.emaDelta || 0).toFixed(3)),
        durationSec,
        sampleRate: "100 Hz IMU / 20 Hz Live",
      },
      steps: currentSessionSteps.current,
      waveform: currentSessionWaveform.current,
    });

    databaseService.addAuthLog({
      timestamp,
      userId: resolvedUser,
      score: scoreStr,
      status: decision,
      incremental: deltaStr,
      message: decision === "SUCCESS"
        ? `Autentikasi Berhasil - Pintu Terbuka (${resolvedUser})`
        : `Autentikasi Ditolak - Pola Gaya Berjalan Tidak Cocok (${scoreStr})`,
      details: finalDetails,
    }).catch(console.error);
  }, []);

  // ── Penanganan Diskoneksi Mandiri ─────────────────────────────────────────
  const onWearableDisconnected = useCallback((devId: string) => {
    console.log("[BLE] Wearable disconnected:", devId);
    setWearableState("disconnected");
    setWearableDeviceId(null);
    wearableDeviceIdRef.current = null;
    addLog({ type: "system", status: "Warning", message: "Terputus dari Wearable (Arduino RP2040)" });

    if (!manualDisconnectWearableRef.current) {
      if (autoConnectTimerRef.current) clearTimeout(autoConnectTimerRef.current);
      autoConnectTimerRef.current = setTimeout(() => {
        addLog({ type: "system", status: "Info", message: "Mencoba auto-reconnect ke Wearable..." });
        if (autoConnectRef.current) autoConnectRef.current();
      }, 3000);
    }
  }, [addLog]);

  const onDoorLockDisconnected = useCallback((devId: string) => {
    console.log("[BLE] DoorLock disconnected:", devId);
    setDoorLockState("disconnected");
    setDoorLockDeviceId(null);
    doorLockDeviceIdRef.current = null;
    setIsDoorUnlocked(false);
    addLog({ type: "system", status: "Warning", message: "Terputus dari Smart Door Lock (ESP32)" });

    if (!manualDisconnectDoorLockRef.current) {
      if (autoConnectTimerRef.current) clearTimeout(autoConnectTimerRef.current);
      autoConnectTimerRef.current = setTimeout(() => {
        addLog({ type: "system", status: "Info", message: "Mencoba auto-reconnect ke Door Lock..." });
        if (autoConnectRef.current) autoConnectRef.current();
      }, 3000);
    }
  }, [addLog]);

  // ── Callback Notifikasi dari ESP32 Door Lock ──────────────────────────────
  const handleDoorLockNotification = useCallback((value: DataView) => {
    try {
      const text = dataViewToText(value);
      console.log("[BLE ESP32 Door Notification]", text);

      if (text === "DOOR_OPENED" || text.includes("UNLOCKED")) {
        setIsDoorUnlocked(true);
        addLog({ type: "system", status: "Success", message: "ESP32: Solenoid Terbuka (Door Unlocked)" });
      } else if (text === "DOOR_LOCKED" || text.includes("LOCKED")) {
        setIsDoorUnlocked(false);
        addLog({ type: "system", status: "Info", message: "ESP32: Solenoid Mengunci (Door Locked)" });
      }
    } catch (err) {
      console.error("Gagal membaca notifikasi status pintu ESP32:", err);
    }
  }, [addLog]);

  // ── Callback Notifikasi dari Arduino Wearable (DOOR / CONTROL) ─────────────
  const handleWearableDoorNotification = useCallback(async (value: DataView) => {
    try {
      const text = dataViewToText(value);
      console.log("[BLE Wearable Door Notification]", text);

      if (text.startsWith("SCORES:")) {
        // Parsing paket diagnostik breakdown skor multiclass per-slot dari RP2040
        // Format: "SCORES:0:83.2|1:45.3|2:21.0|3:18.5" (mendukung pemisah '|' maupun ';')
        const raw = text.substring(7);
        const delimiter = raw.includes("|") ? "|" : ";";
        const parts = raw.split(delimiter);
        const list: Array<{ slot: number; score: number }> = [];
        parts.forEach((p) => {
          if (!p.trim()) return;
          const kvDelim = p.includes(":") ? ":" : "=";
          const [sStr, scStr] = p.split(kvDelim);
          if (sStr !== undefined && scStr !== undefined) {
            const slot = parseInt(sStr.trim(), 10);
            const score = parseFloat(scStr.trim());
            if (!isNaN(slot) && !isNaN(score)) {
              list.push({ slot, score });
            }
          }
        });
        if (list.length > 0) {
          latestAuthScoresRef.current = list;
          console.log("[AUTH BREAKDOWN]", list);
        }
      } else if (text.startsWith("GATES:")) {
        // Parsing paket diagnostik gerbang fisik (Tahap 0: Shadow Mode Diagnostics)
        // Format: "GATES:j=0.215|a=1.45|ex=28.5|cf=2.35|ad=0.68|dG=12.3" (mendukung '|' maupun ';')
        const raw = text.substring(6);
        const delimiter = raw.includes("|") ? "|" : ";";
        const parts = raw.split(delimiter);
        const gData = {
          normJerk: 0,
          asym: 1.0,
          excursion: 0,
          crestFactor: 0,
          axisDominance: 0,
          deltaGyro: 0,
        };
        parts.forEach((p) => {
          if (!p.trim()) return;
          const [k, v] = p.split("=");
          if (k && v !== undefined) {
            const key = k.trim();
            const val = parseFloat(v.trim());
            if (!isNaN(val)) {
              if (key === "j" || key === "nj") gData.normJerk = val;
              else if (key === "a" || key === "as") gData.asym = val;
              else if (key === "ex") gData.excursion = val;
              else if (key === "cf") gData.crestFactor = val;
              else if (key === "ad") gData.axisDominance = val;
              else if (key === "dG") gData.deltaGyro = val;
            }
          }
        });
        latestGatesRef.current = gData;
        console.log("[DIAGNOSTIC GATES]", gData);
      } else if (text.startsWith("OPEN_DOOR")) {
        const parts = text.split(":");
        const name = parts.length > 1 ? parts.slice(1).join(":").trim() : "Owner";
        const cleanName = (name && name !== "PIN_BYPASS") ? name : null;
        if (cleanName) {
          verifiedUserNameRef.current = cleanName;
          setVerifiedUserName(cleanName);
        } else if (name === "PIN_BYPASS") {
          verifiedUserNameRef.current = "PIN_BYPASS";
          setVerifiedUserName("PIN_BYPASS");
        }
        setBleData(prev => ({ ...prev, authStatus: "success" }));
        
        if (name === "PIN_BYPASS") {
          addLog({ type: "system", status: "Success", message: "Akses Diterima: Pintu Terbuka via PIN Bypass" });
        } else {
          addLog({ type: "system", status: "Success", message: `Akses Diterima: Identitas ${cleanName || name} Terverifikasi!` });
        }

        // AUTO-FORWARD KE ESP32 DOOR LOCK: Memicu relay solenoid fisik
        if (doorLockDeviceIdRef.current) {
          try {
            await BleClient.writeWithoutResponse(
              doorLockDeviceIdRef.current,
              SMART_KEY_SERVICE_UUID,
              DOOR_CHARACTERISTIC_UUID,
              textToDataView(text)
            );
            addLog({ type: "system", status: "Success", message: "Sinyal Buka Pintu (OPEN_DOOR) otomatis diteruskan ke ESP32 Solenoid" });
          } catch (fwdErr) {
            console.error("Gagal meneruskan OPEN_DOOR ke ESP32:", fwdErr);
            addLog({ type: "system", status: "Warning", message: "Gagal meneruskan sinyal buka ke ESP32 Door Lock" });
          }
        } else {
          addLog({ type: "system", status: "Warning", message: "ESP32 Door Lock belum terhubung (Solenoid fisik tidak dipicu)" });
        }

        // Catat langsung hasil autentikasi sukses ke database SQLite
        if (activeSessionInfo.current.mode === "auth" && !sessionLogged.current) {
          logAuthSession("SUCCESS", cleanName || (name !== "PIN_BYPASS" ? name : "PIN Bypass"));
        }
      } else if (text === "ACCESS_DENIED") {
        setBleData(prev => ({ ...prev, authStatus: "failed" }));
        addLog({ type: "system", status: "Failed", message: "Akses Ditolak: Pola Gait Tidak Cocok" });

        if (activeSessionInfo.current.mode === "auth" && !sessionLogged.current) {
          logAuthSession("FAILED");
        }
      } else if (text === "CLOSE_DOOR") {
        addLog({ type: "system", status: "Info", message: "Pintu Terkunci (CLOSE_DOOR)" });
        // Teruskan juga perintah close ke ESP32 jika terhubung
        if (doorLockDeviceIdRef.current) {
          try {
            await BleClient.writeWithoutResponse(
              doorLockDeviceIdRef.current,
              SMART_KEY_SERVICE_UUID,
              DOOR_CHARACTERISTIC_UUID,
              textToDataView("CLOSE_DOOR")
            );
          } catch (_) {}
        }
      } else if (text.startsWith("TRAIN_SUCCESS")) {
        const parts = text.split(":");
        const trainedSlot = parts.length > 1 ? parseInt(parts[1], 10) : activeSessionInfo.current.slot;
        const trainedName = parts.length > 2 ? parts[2] : (activeSessionInfo.current.name || `User ${trainedSlot + 1}`);
        setBleData(prev => ({ ...prev, progress: 5, authStatus: "success" }));
        addLog({ type: "reg", status: "Success", message: `Pendaftaran Model (${trainedName}) Selesai di Edge RP2040` });
        databaseService.saveUserProfile(trainedSlot, trainedName).catch(console.error);
        setTimeout(() => setFlashSyncVersion((v) => v + 1), 60);
      } else if (text.startsWith("TRAIN_FAILED")) {
        setBleData(prev => ({ ...prev, authStatus: "failed" }));
        addLog({ type: "reg", status: "Failed", message: "Pendaftaran Gagal: Memori Flash RP2040 penuh atau gagal menyimpan profil" });
      } else if (text.startsWith("DEL_SUCCESS")) {
        const parts = text.split(":");
        const slot = parts.length > 1 ? parseInt(parts[1], 10) : 0;
        addLog({ type: "system", status: "Info", message: `Profil Slot ${slot + 1} Terhapus dari Flash RP2040` });
        databaseService.deleteUserProfile(slot).catch(console.error);
        databaseService.removeRegLogsForSlot(slot).catch(console.error);
        setTimeout(() => setFlashSyncVersion((v) => v + 1), 60);
      } else if (text === "DEL_ALL_SUCCESS") {
        addLog({ type: "system", status: "Info", message: "Seluruh Profil di Flash RP2040 Berhasil Diformat" });
        databaseService.clearUserProfiles().catch(console.error);
        databaseService.clearLogs("registrasi").catch(console.error);
        setTimeout(() => setFlashSyncVersion((v) => v + 1), 60);
      } else if (text.startsWith("RENAME_SUCCESS:")) {
        const parts = text.split(":");
        const slot = parts.length > 1 ? parseInt(parts[1], 10) : 0;
        const name = parts.length > 2 ? parts[2] : `User_${slot + 1}`;
        if (name && name.trim()) {
          addLog({ type: "system", status: "Success", message: `Slot ${slot + 1} di Flash RP2040 Diubah Menjadi "${name}"` });
          databaseService.saveUserProfile(slot, name).catch(console.error);
          databaseService.updateRegLogSlotName(slot, name).catch(console.error);
          setTimeout(() => setFlashSyncVersion((v) => v + 1), 60);
        }
      } else if (text.startsWith("FLASH_SLOT:")) {
        const parts = text.split(":");
        const slotIdx = parseInt(parts[1], 10);
        if (slotIdx >= 0 && slotIdx < 6) {
          const isReg = parts[2] === "1";
          const name = parts.length > 3 ? parts[3] : `User_${slotIdx + 1}`;

          if (isReg) {
            databaseService.saveUserProfile(slotIdx, name).catch(console.error);
            databaseService.ensureRegLogForSlot(slotIdx, name).catch(console.error);
          } else {
            databaseService.deleteUserProfile(slotIdx).catch(console.error);
            databaseService.removeRegLogsForSlot(slotIdx).catch(console.error);
          }
        }
      } else if (text === "FLASH_SYNC_DONE") {
        setTimeout(() => setFlashSyncVersion((v) => v + 1), 60);
        addLog({ type: "system", status: "Success", message: "Sinkronisasi Flash Selesai: Log & Slot Flash RP2040 Selaras" });
      }
    } catch (e) {
      console.error("Gagal memproses notifikasi door:", e);
    }
  }, [addLog, logAuthSession]);

  // ── Callback Notifikasi 20 Hz Waveform dari RP2040 ─────────────────────────
  const handleLiveNotification = useCallback((value: DataView) => {
    try {
      if (value.byteLength >= 9) {
        const liveVal = value.getFloat32(0, true);
        const energy = value.getFloat32(4, true);
        const isMoving = value.getUint8(8) === 1;
        const now = Date.now();
        setLiveSample({ liveVal, energy, isMoving, timestamp: now });

        if (activeSessionInfo.current.mode && !sessionLogged.current) {
          if (sessionStartTime.current === 0) {
            sessionStartTime.current = now;
          }
          const relTimeSec = (now - sessionStartTime.current) / 1000;
          currentSessionWaveform.current.push({
            t: parseFloat(relTimeSec.toFixed(2)),
            val: parseFloat(liveVal.toFixed(3)),
            energy: parseFloat(energy.toFixed(3)),
            isMoving,
          });
        }
      }
    } catch (e) {
      console.error("Gagal memproses notifikasi live sample 20 Hz:", e);
    }
  }, []);

  // ── Callback Notifikasi Telemetri Data dari RP2040 ─────────────────────────
  const handleDataNotification = useCallback((value: DataView) => {
    try {
      const timestamp = formatLogTimestamp();
      let windowIndex = 0;
      let zuptCode = 0;
      let isZUPTValid = false;
      let confidenceScore = 0;
      let logLikelihood = 0.0;
      let mean = 0.0;
      let variance = 0.0;
      let stdDev = 0.0;
      let skewness = 0.0;
      let kurtosis = 0.0;
      let adaptiveThreshold = 0.0;
      let emaDelta = 0.0;

      if (value.byteLength >= 18) {
        windowIndex = value.getUint8(0);
        zuptCode = value.getUint8(1);
        isZUPTValid = (zuptCode === 1);
        confidenceScore = value.getFloat32(2, true);
        logLikelihood = value.getFloat32(6, true);
        mean = value.getFloat32(10, true);
        variance = value.getFloat32(14, true);

        stdDev = value.byteLength >= 22 ? value.getFloat32(18, true) : Math.sqrt(Math.max(0, variance));
        skewness = value.byteLength >= 26 ? value.getFloat32(22, true) : 0.0;
        kurtosis = value.byteLength >= 30 ? value.getFloat32(26, true) : 0.0;
        adaptiveThreshold = value.byteLength >= 34 ? value.getFloat32(30, true) : 0.0;
        emaDelta = value.byteLength >= 38 ? value.getFloat32(34, true) : 0.0;
      } else {
        try {
          const text = dataViewToText(value);
          const j = JSON.parse(text);
          windowIndex = j.progress ?? j.windowIndex ?? 0;
          confidenceScore = parseFloat(j.score ?? 0);
          isZUPTValid = j.isZUPTValid ?? true;
        } catch (_) {}
      }

      const zuptStatusStr = isZUPTValid ? "Valid (Active Gait)" : "Still (Discarded)";

      if (windowIndex > lastProgress.current) {
        lastProgress.current = windowIndex;
      }
      const displayProgress = Math.max(windowIndex, lastProgress.current);

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
      const vectorStr = `[${mean.toFixed(1)}°/s, ${variance.toFixed(0)}, ${stdDev.toFixed(1)}%]`;
      const covStr = `[${skewness.toFixed(0)} smp, ${kurtosis.toFixed(1)} %g]`;
      const deltaStr = (emaDelta >= 0 ? "+" : "") + emaDelta.toFixed(2);

      const authStatus = displayProgress >= 5
        ? (confidenceScore >= 80.0 ? "success" : "failed")
        : (displayProgress > 0 ? "scanning" : "idle");

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
          dw: "1.5s (N=150)",
        }
      };

      latestTelemetryRef.current = newBleData.telemetry;
      setBleData(newBleData);

      if (displayProgress >= 5 && !sessionLogged.current) {
        const sessionMode = activeSessionInfo.current.mode;
        if (sessionMode === "training") {
          sessionLogged.current = true;
          const durationSec = sessionStartTime.current > 0
            ? parseFloat(((Date.now() - sessionStartTime.current) / 1000).toFixed(1))
            : 7.5;

          const targetSlot = activeSessionInfo.current.slot;
          const targetName = activeSessionInfo.current.name || `User ${targetSlot + 1}`;

          const finalDetails = JSON.stringify({
            version: 2,
            mode: "training",
            targetUser: targetName,
            summary: {
              totalWindows: displayProgress,
              confidenceScore: parseFloat(confidenceScore.toFixed(1)),
              logLikelihood: parseFloat(logLikelihood.toFixed(2)),
              mean: parseFloat(mean.toFixed(3)),
              variance: parseFloat(variance.toFixed(3)),
              stdDev: parseFloat(stdDev.toFixed(3)),
              skewness: parseFloat(skewness.toFixed(3)),
              kurtosis: parseFloat(kurtosis.toFixed(3)),
              adaptiveThreshold: parseFloat(adaptiveThreshold.toFixed(2)),
              emaDelta: parseFloat(emaDelta.toFixed(3)),
              durationSec,
              sampleRate: "100 Hz IMU / 20 Hz Live",
            },
            steps: currentSessionSteps.current,
            waveform: currentSessionWaveform.current,
          });

          databaseService.addRegLog({
            timestamp,
            slotUser: `Slot ${targetSlot + 1} (${targetName})`,
            totalJendela: 5,
            statusAkhir: "SUCCESS",
            message: `Perekaman 5 Jendela Gait (${targetName}) Sukses`,
            details: finalDetails,
          }).catch(console.error);

          databaseService.saveUserProfile(targetSlot, targetName).then(() => {
            setTimeout(() => setFlashSyncVersion((v) => v + 1), 60);
          }).catch(console.error);
        } else if (sessionMode === "auth") {
          setTimeout(() => {
            if (!sessionLogged.current && activeSessionInfo.current.mode === "auth") {
              logAuthSession(confidenceScore >= 80.0 ? "SUCCESS" : "FAILED");
            }
          }, 450);
        }
      }
    } catch (err) {
      console.error("Gagal memproses data notifikasi BLE:", err);
    }
  }, [logAuthSession]);

  // ── Setup Notifikasi Perangkat Wearable ────────────────────────────────────
  const setupNotificationsForWearable = async (targetDeviceId: string) => {
    // 1. Telemetri data klasifikasi GHMM
    await BleClient.startNotifications(
      targetDeviceId,
      SMART_KEY_SERVICE_UUID,
      DATA_CHARACTERISTIC_UUID,
      handleDataNotification
    );

    // 2. Sinyal kontrol pintu & event status (OPEN_DOOR / ACCESS_DENIED)
    try {
      await BleClient.startNotifications(
        targetDeviceId,
        SMART_KEY_SERVICE_UUID,
        DOOR_CHARACTERISTIC_UUID,
        handleWearableDoorNotification
      );
    } catch (doorErr) {
      console.log("Door notification fallback:", doorErr);
    }

    // 3. 20 Hz Live Waveform Data
    try {
      await BleClient.startNotifications(
        targetDeviceId,
        SMART_KEY_SERVICE_UUID,
        LIVE_CHARACTERISTIC_UUID,
        handleLiveNotification
      );
    } catch (liveErr) {
      console.log("Live 20Hz notification fallback:", liveErr);
    }
  };

  // ── Setup Notifikasi Perangkat ESP32 Door Lock ────────────────────────────
  const setupNotificationsForDoorLock = async (targetDeviceId: string) => {
    try {
      await BleClient.startNotifications(
        targetDeviceId,
        SMART_KEY_SERVICE_UUID,
        DOOR_CHARACTERISTIC_UUID,
        handleDoorLockNotification
      );
    } catch (doorErr) {
      console.log("ESP32 Door Lock notification error:", doorErr);
    }
  };

  // ── Koneksi Wearable ──────────────────────────────────────────────────────
  const performWearableConnection = async (targetDevice: { deviceId: string; name?: string }) => {
    addLog({ type: "system", status: "Info", message: `Menghubungkan ke Wearable (${targetDevice.name || "RP2040"})...` });
    setWearableState("connecting");
    await BleClient.connect(targetDevice.deviceId, (id) => onWearableDisconnected(id));
    await setupNotificationsForWearable(targetDevice.deviceId);

    localStorage.setItem("smartkey_wearable_id", targetDevice.deviceId);
    localStorage.setItem("smartkey_last_device_id", targetDevice.deviceId);
    if (targetDevice.name) {
      localStorage.setItem("smartkey_wearable_name", targetDevice.name);
    }

    wearableDeviceIdRef.current = targetDevice.deviceId;
    setWearableDeviceId(targetDevice.deviceId);
    setWearableState("connected");
    manualDisconnectWearableRef.current = false;
    addLog({ type: "system", status: "Success", message: `Berhasil terhubung ke Wearable (${targetDevice.name || "SmartKey_Wearable"})` });
  };

  // ── Koneksi ESP32 Door Lock ───────────────────────────────────────────────
  const performDoorLockConnection = async (targetDevice: { deviceId: string; name?: string }) => {
    addLog({ type: "system", status: "Info", message: `Menghubungkan ke Solenoid Door Lock (${targetDevice.name || "ESP32"})...` });
    setDoorLockState("connecting");
    await BleClient.connect(targetDevice.deviceId, (id) => onDoorLockDisconnected(id));
    await setupNotificationsForDoorLock(targetDevice.deviceId);

    localStorage.setItem("smartkey_doorlock_id", targetDevice.deviceId);
    if (targetDevice.name) {
      localStorage.setItem("smartkey_doorlock_name", targetDevice.name);
    }

    doorLockDeviceIdRef.current = targetDevice.deviceId;
    setDoorLockDeviceId(targetDevice.deviceId);
    setDoorLockState("connected");
    manualDisconnectDoorLockRef.current = false;
    addLog({ type: "system", status: "Success", message: `Berhasil terhubung ke Door Lock (${targetDevice.name || "SmartKey_DoorLock"})` });
  };

  // ── Auto-Connect Cerdas Dual Peripheral ───────────────────────────────────
  const autoConnect = useCallback(async () => {
    if (isAutoConnectingRef.current) return;

    try {
      isAutoConnectingRef.current = true;
      await BleClient.initialize();

      const lastWearableId = localStorage.getItem("smartkey_wearable_id") || localStorage.getItem("smartkey_last_device_id");
      const lastDoorLockId = localStorage.getItem("smartkey_doorlock_id");

      // 1. Coba koneksi langsung ke Wearable jika belum terhubung
      if (lastWearableId && wearableStateRef.current !== "connected" && !manualDisconnectWearableRef.current) {
        try {
          console.log("[BLE AUTO] Direct connect ke Wearable:", lastWearableId);
          await performWearableConnection({ deviceId: lastWearableId, name: "SmartKey_Wearable" });
        } catch (e) {
          console.log("[BLE AUTO] Direct connect Wearable gagal:", e);
        }
      }

      // 2. Coba koneksi langsung ke ESP32 Door Lock jika belum terhubung
      if (lastDoorLockId && doorLockStateRef.current !== "connected" && !manualDisconnectDoorLockRef.current) {
        try {
          console.log("[BLE AUTO] Direct connect ke DoorLock:", lastDoorLockId);
          await performDoorLockConnection({ deviceId: lastDoorLockId, name: "SmartKey_DoorLock" });
        } catch (e) {
          console.log("[BLE AUTO] Direct connect DoorLock gagal:", e);
        }
      }

      // 3. Jika salah satu atau keduanya belum terhubung, jalankan scan latar belakang
      const needWearable = wearableStateRef.current !== "connected" && !manualDisconnectWearableRef.current;
      const needDoorLock = doorLockStateRef.current !== "connected" && !manualDisconnectDoorLockRef.current;

      if (needWearable || needDoorLock) {
        console.log("[BLE AUTO] Memulai background scan dual device...");
        await BleClient.requestLEScan(
          { services: [SMART_KEY_SERVICE_UUID] },
          async (result) => {
            if (!result.device) return;
            const devName = result.device.name || result.localName || "";
            const dId = result.device.deviceId;

            if (devName.includes("DoorLock") && doorLockStateRef.current !== "connected") {
              try {
                await performDoorLockConnection({ deviceId: dId, name: devName });
              } catch (connErr) {
                console.error("[BLE AUTO] Gagal hubungkan door lock:", connErr);
              }
            } else if ((devName.includes("Wearable") || (!devName.includes("DoorLock") && devName.includes("SmartKey"))) && wearableStateRef.current !== "connected") {
              try {
                await performWearableConnection({ deviceId: dId, name: devName || "SmartKey_Wearable" });
              } catch (connErr) {
                console.error("[BLE AUTO] Gagal hubungkan wearable:", connErr);
              }
            }

            // Jika keduanya sudah terhubung, hentikan scan lebih awal
            if (wearableStateRef.current === "connected" && doorLockStateRef.current === "connected") {
              try {
                await BleClient.stopLEScan();
              } catch (_) {}
            }
          }
        );

        // Scan dibatasi 6 detik
        setTimeout(async () => {
          try {
            await BleClient.stopLEScan();
          } catch (_) {}
          isAutoConnectingRef.current = false;
        }, 6000);
      } else {
        isAutoConnectingRef.current = false;
      }
    } catch (err) {
      console.log("[BLE AUTO] Error auto connect:", err);
      isAutoConnectingRef.current = false;
    }
  }, []);

  useEffect(() => {
    autoConnectRef.current = autoConnect;
  }, [autoConnect]);

  useEffect(() => {
    const startupTimer = setTimeout(() => {
      autoConnect();
    }, 1500);

    return () => {
      clearTimeout(startupTimer);
      if (autoConnectTimerRef.current) clearTimeout(autoConnectTimerRef.current);
    };
  }, [autoConnect]);

  // ── Dialog Pemilihan Perangkat BLE Manual ─────────────────────────────────
  const connectWearable = async () => {
    manualDisconnectWearableRef.current = false;
    try {
      setWearableState("connecting");
      addLog({ type: "system", status: "Info", message: "Mencari Wearable BLE..." });
      await BleClient.initialize();
      const selected = await BleClient.requestDevice({ services: [SMART_KEY_SERVICE_UUID] });
      await performWearableConnection(selected);
    } catch (err) {
      setWearableState("disconnected");
      addLog({ type: "system", status: "Failed", message: `Koneksi Wearable gagal: ${(err as Error).message}` });
    }
  };

  const connectDoorLock = async () => {
    manualDisconnectDoorLockRef.current = false;
    try {
      setDoorLockState("connecting");
      addLog({ type: "system", status: "Info", message: "Mencari Smart Door Lock ESP32..." });
      await BleClient.initialize();
      const selected = await BleClient.requestDevice({ services: [SMART_KEY_SERVICE_UUID] });
      await performDoorLockConnection(selected);
    } catch (err) {
      setDoorLockState("disconnected");
      addLog({ type: "system", status: "Failed", message: `Koneksi Door Lock gagal: ${(err as Error).message}` });
    }
  };

  const connect = async () => {
    // Default action tombol connect: jika wearable belum terhubung, hubungkan wearable; atau sebaliknya
    manualDisconnectWearableRef.current = false;
    manualDisconnectDoorLockRef.current = false;
    try {
      await BleClient.initialize();
      const selected = await BleClient.requestDevice({ services: [SMART_KEY_SERVICE_UUID] });
      const name = selected.name || "";
      if (name.includes("DoorLock")) {
        await performDoorLockConnection(selected);
      } else {
        await performWearableConnection(selected);
      }
    } catch (err) {
      addLog({ type: "system", status: "Failed", message: `Koneksi gagal: ${(err as Error).message}` });
    }
  };

  const disconnectWearable = useCallback(async () => {
    manualDisconnectWearableRef.current = true;
    if (wearableDeviceIdRef.current) {
      try {
        await BleClient.disconnect(wearableDeviceIdRef.current);
      } catch (err) {
        console.error(err);
      }
    }
    setWearableState("disconnected");
    setWearableDeviceId(null);
    wearableDeviceIdRef.current = null;
    addLog({ type: "system", status: "Info", message: "Koneksi Wearable diputus secara manual" });
  }, [addLog]);

  const disconnectDoorLock = useCallback(async () => {
    manualDisconnectDoorLockRef.current = true;
    if (doorLockDeviceIdRef.current) {
      try {
        await BleClient.disconnect(doorLockDeviceIdRef.current);
      } catch (err) {
        console.error(err);
      }
    }
    setDoorLockState("disconnected");
    setDoorLockDeviceId(null);
    doorLockDeviceIdRef.current = null;
    setIsDoorUnlocked(false);
    addLog({ type: "system", status: "Info", message: "Koneksi Smart Door Lock diputus secara manual" });
  }, [addLog]);

  const disconnect = useCallback(async () => {
    await disconnectWearable();
    await disconnectDoorLock();
  }, [disconnectWearable, disconnectDoorLock]);

  // ── Kirim Perintah ke Arduino RP2040 ──────────────────────────────────────
  const sendCommand = async (cmd: string): Promise<boolean> => {
    // Jika perintah adalah kontrol pintu manual, teruskan juga ke ESP32 Door Lock
    if (cmd === "LOCK_DOOR" || cmd === "CLOSE_DOOR") {
      await sendDoorCommand("CLOSE_DOOR");
    } else if (cmd === "UNLOCK_MANUAL" || cmd.startsWith("PIN_")) {
      await sendDoorCommand("OPEN_DOOR:PIN_BYPASS");
    }

    if (!wearableDeviceIdRef.current) {
      addLog({ type: "system", status: "Failed", message: "Wearable RP2040 belum terhubung" });
      return false;
    }

    try {
      await BleClient.write(
        wearableDeviceIdRef.current,
        SMART_KEY_SERVICE_UUID,
        COMMAND_CHARACTERISTIC_UUID,
        textToDataView(cmd)
      );
      addLog({ type: "system", status: "Success", message: `Perintah Wearable: ${cmd}` });
      return true;
    } catch (error) {
      console.error("Gagal mengirim perintah ke Wearable", error);
      addLog({ type: "system", status: "Failed", message: `Gagal mengirim ke Wearable: ${(error as Error).message}` });
      return false;
    }
  };

  // ── Kirim Perintah Langsung ke ESP32 Solenoid Door Lock ───────────────────
  const sendDoorCommand = async (cmd: string): Promise<boolean> => {
    let success = false;
    if (doorLockDeviceIdRef.current) {
      try {
        await BleClient.write(
          doorLockDeviceIdRef.current,
          SMART_KEY_SERVICE_UUID,
          DOOR_CHARACTERISTIC_UUID,
          textToDataView(cmd)
        );
        addLog({ type: "system", status: "Success", message: `Perintah Door Lock (ESP32): ${cmd}` });
        success = true;
      } catch (err) {
        console.error("Gagal mengirim perintah ke ESP32 Door Lock:", err);
        addLog({ type: "system", status: "Failed", message: `Gagal kirim ke Door Lock: ${(err as Error).message}` });
      }
    } else {
      addLog({ type: "system", status: "Warning", message: "ESP32 Door Lock belum terhubung Bluetooth" });
    }

    return success;
  };

  // ── Operasi Flash Memori RP2040 ───────────────────────────────────────────
  const syncFlashUsers = useCallback(async (): Promise<boolean> => {
    if (wearableStateRef.current !== "connected") {
      addLog({ type: "system", status: "Warning", message: "Gagal sinkron: Wearable belum terhubung Bluetooth" });
      return false;
    }
    addLog({ type: "system", status: "Info", message: "Meminta sinkronisasi status Flash memori RP2040..." });
    return await sendCommand("SYNC_FLASH");
  }, [sendCommand, addLog]);

  const deleteFlashUser = useCallback(async (slot: number): Promise<boolean> => {
    if (wearableStateRef.current !== "connected") {
      addLog({ type: "system", status: "Warning", message: "Gagal hapus: Wearable belum terhubung Bluetooth" });
      return false;
    }
    addLog({ type: "system", status: "Info", message: `Menghapus Slot ${slot + 1} dari Flash RP2040...` });
    const ok = await sendCommand(`DEL:${slot}`);
    if (ok) {
      await databaseService.deleteUserProfile(slot);
      await databaseService.removeRegLogsForSlot(slot);
      setTimeout(() => setFlashSyncVersion((v) => v + 1), 60);
    }
    return ok;
  }, [sendCommand, addLog]);

  const formatFlashMemory = useCallback(async (): Promise<boolean> => {
    if (wearableStateRef.current !== "connected") {
      addLog({ type: "system", status: "Warning", message: "Gagal format: Wearable belum terhubung Bluetooth" });
      return false;
    }
    addLog({ type: "system", status: "Warning", message: "Memformat seluruh memori Flash RP2040..." });
    const ok = await sendCommand("DEL:ALL");
    if (ok) {
      await databaseService.clearUserProfiles();
      await databaseService.clearLogs("registrasi");
      setTimeout(() => setFlashSyncVersion((v) => v + 1), 60);
    }
    return ok;
  }, [sendCommand, addLog]);

  return (
    <BLEContext.Provider value={{
      connectionState: wearableState, // Backward compatible mapping
      wearableState,
      doorLockState,
      wearableDeviceId,
      doorLockDeviceId,
      isDoorUnlocked,
      bleData,
      liveSample,
      logs,
      connect,
      connectWearable,
      connectDoorLock,
      autoConnect,
      disconnect,
      disconnectWearable,
      disconnectDoorLock,
      sendCommand,
      sendDoorCommand,
      addLog,
      resetBleData,
      setBleData,
      setActiveSession,
      recordStepTelemetry,
      verifiedUserName,
      syncFlashUsers,
      deleteFlashUser,
      formatFlashMemory,
      flashSyncVersion,
    }}>
      {children}
    </BLEContext.Provider>
  );
}
