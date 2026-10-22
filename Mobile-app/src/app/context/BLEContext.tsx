import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect, useRef } from "react";
import { BleClient, dataViewToText, textToDataView } from "@capacitor-community/bluetooth-le";
import { databaseService, formatLogTimestamp } from "../services/databaseService";

// UUID BLE selaras dengan firmware RP2040 (Filmware/src/nano/config.h)
const SMART_KEY_SERVICE_UUID = "19b10000-e8f2-537e-4f6c-d104768a1214";
const DATA_CHARACTERISTIC_UUID = "19b10002-e8f2-537e-4f6c-d104768a1214"; // TX Telemetri dari RP2040 (Notifications)
const COMMAND_CHARACTERISTIC_UUID = "19b10001-e8f2-537e-4f6c-d104768a1214"; // RX Command ke RP2040 (Trigger/Write)
const DOOR_CHARACTERISTIC_UUID = "19b10003-e8f2-537e-4f6c-d104768a1214"; // TX Door Command dari RP2040 (Notifications)
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
  connectionState: BLEConnectionState;
  bleData: BLEData;
  liveSample: LiveSample | null;
  logs: LogEntry[];
  connect: () => Promise<void>;
  autoConnect: () => Promise<void>;
  disconnect: () => void;
  sendCommand: (cmd: string) => Promise<boolean>;
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
  const [connectionState, setConnectionState] = useState<BLEConnectionState>("disconnected");
  const [bleData, setBleData] = useState<BLEData>(defaultBLEData);
  const [liveSample, setLiveSample] = useState<LiveSample | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);

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

  // Status & Timer Auto-Reconnect Cerdas
  const manualDisconnectRef = useRef<boolean>(false);
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
  const latestTelemetryRef = useRef<BLETelemetry>(defaultBLEData.telemetry);

  const setActiveSession = useCallback((info: { mode: "auth" | "training" | null; slot: number; name: string }) => {
    activeSessionInfo.current = info;
    sessionLogged.current = false;
    sessionStartTime.current = info.mode ? Date.now() : 0;
    currentSessionSteps.current = [];
    currentSessionWaveform.current = [];
    latestAuthScoresRef.current = [];
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
    latestTelemetryRef.current = defaultBLEData.telemetry;
    setVerifiedUserName(null);
    currentSessionSteps.current = [];
  }, []);

  const onDisconnected = useCallback((disconnectedDeviceId: string) => {
    setConnectionState("disconnected");
    setDeviceId(null);
    addLog({ type: "system", status: "Info", message: "Terputus dari Smart Key" });

    // Jika bukan pemutusan manual oleh pengguna, jadwalkan auto-reconnect dalam 3 detik
    if (!manualDisconnectRef.current) {
      if (autoConnectTimerRef.current) clearTimeout(autoConnectTimerRef.current);
      autoConnectTimerRef.current = setTimeout(() => {
        addLog({ type: "system", status: "Info", message: "Mencoba auto-reconnect ke Smart Key..." });
        if (autoConnectRef.current) {
          autoConnectRef.current();
        }
      }, 3000);
    }
  }, [addLog]);

  const logAuthSession = useCallback((decision: "SUCCESS" | "FAILED", userName?: string) => {
    if (sessionLogged.current || activeSessionInfo.current.mode !== "auth") return;
    sessionLogged.current = true;

    const timestamp = formatLogTimestamp();
    const durationSec = sessionStartTime.current > 0
      ? parseFloat(((Date.now() - sessionStartTime.current) / 1000).toFixed(1))
      : 7.5;
    const t = latestTelemetryRef.current;

    // Prioritaskan skor kandidat tertinggi dari paket SCORES agar konsisten dengan rincian kandidat 1-vs-All
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
      summary: {
        totalWindows: Math.max(lastProgress.current || 5, currentSessionSteps.current.length, 5),
        confidenceScore: parseFloat(scoreVal.toFixed(1)),
        logLikelihood: parseFloat(((t.logLikelihood !== undefined && t.logLikelihood !== 0) ? t.logLikelihood : -25.0).toFixed(2)),
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

    if (decision === "SUCCESS") {
      databaseService.addAuthLog({
        timestamp,
        userId: resolvedUser,
        score: scoreStr,
        status: "SUCCESS",
        incremental: `Adaptive (${deltaStr})`,
        message: `Verifikasi Gait Berhasil (${resolvedUser}) - Akses Terbuka`,
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
  }, []);

  const handleDoorNotification = useCallback((value: DataView) => {
    try {
      const text = dataViewToText(value).trim();
      console.log("[BLE DOOR EVENT]", text);
      if (text.startsWith("SCORES:")) {
        // Parsing multi-user score breakdown, misal: "SCORES:0:62.5|1:81.2|2:45.0"
        const scoresRaw = text.substring(7);
        const items = scoresRaw.split("|");
        const list: { slot: number; score: number }[] = [];
        items.forEach((item) => {
          const [sStr, scStr] = item.split(":");
          if (sStr !== undefined && scStr !== undefined) {
            const slot = parseInt(sStr, 10);
            const score = parseFloat(scStr);
            if (!isNaN(slot) && !isNaN(score)) {
              list.push({ slot, score });
            }
          }
        });
        latestAuthScoresRef.current = list;
        console.log("[AUTH BREAKDOWN]", list);
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

        // Catat langsung hasil autentikasi sukses ke database SQLite
        if (activeSessionInfo.current.mode === "auth" && !sessionLogged.current) {
          logAuthSession("SUCCESS", cleanName || (name !== "PIN_BYPASS" ? name : "PIN Bypass"));
        }
      } else if (text === "ACCESS_DENIED") {
        setBleData(prev => ({ ...prev, authStatus: "failed" }));
        addLog({ type: "system", status: "Failed", message: "Akses Ditolak: Pola Gait Tidak Cocok" });

        // Catat langsung hasil autentikasi ditolak ke database SQLite
        if (activeSessionInfo.current.mode === "auth" && !sessionLogged.current) {
          logAuthSession("FAILED");
        }
      } else if (text === "CLOSE_DOOR") {
        addLog({ type: "system", status: "Info", message: "Pintu Terkunci (CLOSE_DOOR)" });
      } else if (text.startsWith("TRAIN_SUCCESS")) {
        const parts = text.split(":");
        const trainedSlot = parts.length > 1 ? parseInt(parts[1], 10) : activeSessionInfo.current.slot;
        const trainedName = parts.length > 2 ? parts[2] : (activeSessionInfo.current.name || `User ${trainedSlot + 1}`);
        setBleData(prev => ({ ...prev, progress: 5, authStatus: "success" }));
        addLog({ type: "reg", status: "Success", message: `Pendaftaran Model (${trainedName}) Selesai di Edge RP2040` });
        databaseService.saveUserProfile(trainedSlot, trainedName).catch(console.error);
        setTimeout(() => setFlashSyncVersion((v) => v + 1), 60);
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
      } else if (text.startsWith("FLASH_SLOT:")) {
        const parts = text.split(":");
        const slotIdx = parseInt(parts[1], 10);
        if (slotIdx >= 0 && slotIdx < 4) {
          const isReg = parts[2] === "1";
          const name = parts.length > 3 ? parts[3] : `User_${slotIdx + 1}`;

          if (isReg) {
            databaseService.saveUserProfile(slotIdx, name).catch(console.error);
            databaseService.ensureRegLogForSlot(slotIdx, name).catch(console.error);
          } else {
            // Jika di flash RP2040 slot ini kosong, bersihkan profil aktif & log slot terkait agar selaras
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
  }, [addLog]);

  const handleLiveNotification = useCallback((value: DataView) => {
    try {
      if (value.byteLength >= 9) {
        const liveVal = value.getFloat32(0, true);
        const energy = value.getFloat32(4, true);
        const isMoving = value.getUint8(8) === 1;
        const now = Date.now();
        setLiveSample({ liveVal, energy, isMoving, timestamp: now });

        // Rekam titik gelombang IMU 20 Hz beresolusi tinggi selama sesi aktif berlangsung
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
        skewness = value.byteLength >= 26 ? value.getFloat32(22, true) : 0.0;
        kurtosis = value.byteLength >= 30 ? value.getFloat32(26, true) : 0.0;
        adaptiveThreshold = value.byteLength >= 34 ? value.getFloat32(30, true) : 0.0;
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
      const zuptStatusStr = isZUPTValid ? "Valid (Active Gait)" : "Still (Discarded)";

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

      // Simpan ke Log SQLite saat sesi selesai (5/5)
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
          // Mode autentikasi: beri toleransi 450ms bagi paket SCORES & OPEN_DOOR/ACCESS_DENIED dari RP2040 agar rincian tercatat lengkap
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
  }, [verifiedUserName]);

  const setupNotificationsForDevice = async (targetDeviceId: string) => {
    // 1. Setup Notifications untuk Telemetri Data
    await BleClient.startNotifications(
      targetDeviceId,
      SMART_KEY_SERVICE_UUID,
      DATA_CHARACTERISTIC_UUID,
      handleDataNotification
    );

    // 2. Setup Notifications untuk Sinyal Kontrol Pintu (OPEN_DOOR / ACCESS_DENIED)
    try {
      await BleClient.startNotifications(
        targetDeviceId,
        SMART_KEY_SERVICE_UUID,
        DOOR_CHARACTERISTIC_UUID,
        handleDoorNotification
      );
    } catch (doorErr) {
      console.log("Door notification optional fallback:", doorErr);
    }

    // 3. Setup Notifications untuk 20 Hz Live Waveform Data (Pure Real Data)
    try {
      await BleClient.startNotifications(
        targetDeviceId,
        SMART_KEY_SERVICE_UUID,
        LIVE_CHARACTERISTIC_UUID,
        handleLiveNotification
      );
    } catch (liveErr) {
      console.log("Live 20Hz notification optional fallback:", liveErr);
    }
  };

  const performConnection = async (targetDevice: { deviceId: string; name?: string }) => {
    addLog({ type: "system", status: "Info", message: `Menghubungkan ke ${targetDevice.name || "Smart Key"}...` });
    await BleClient.connect(targetDevice.deviceId, (id) => onDisconnected(id));
    await setupNotificationsForDevice(targetDevice.deviceId);

    localStorage.setItem("smartkey_last_device_id", targetDevice.deviceId);
    if (targetDevice.name) {
      localStorage.setItem("smartkey_last_device_name", targetDevice.name);
    }

    setDeviceId(targetDevice.deviceId);
    setConnectionState("connected");
    manualDisconnectRef.current = false;
    addLog({ type: "system", status: "Success", message: "Berhasil terhubung ke Smart Key" });
  };

  const autoConnect = useCallback(async () => {
    if (connectionState === "connected" || isAutoConnectingRef.current || manualDisconnectRef.current) {
      return;
    }

    try {
      isAutoConnectingRef.current = true;
      await BleClient.initialize();

      const lastId = localStorage.getItem("smartkey_last_device_id");
      const lastName = localStorage.getItem("smartkey_last_device_name") || "SmartKey_Wearable";

      // 1. Coba koneksi langsung ke ID perangkat terakhir yang pernah terhubung
      if (lastId) {
        try {
          console.log("[BLE AUTO] Mencoba direct-connect ke:", lastId);
          setConnectionState("connecting");
          await performConnection({ deviceId: lastId, name: lastName });
          isAutoConnectingRef.current = false;
          return;
        } catch (directErr) {
          console.log("[BLE AUTO] Direct connect gagal, beralih ke scan...", directErr);
        }
      }

      // 2. Scan latar belakang untuk mencari perangkat dengan Service UUID SmartKey
      console.log("[BLE AUTO] Memulai background scan...");
      setConnectionState("connecting");
      let foundDevice: { deviceId: string; name?: string } | null = null;

      await BleClient.requestLEScan(
        { services: [SMART_KEY_SERVICE_UUID] },
        async (result) => {
          if (!foundDevice && result.device) {
            const devName = result.device.name || result.localName || "";
            if (devName.includes("SmartKey") || result.device.deviceId === lastId || !devName) {
              foundDevice = {
                deviceId: result.device.deviceId,
                name: devName || "SmartKey_Wearable",
              };
              try {
                await BleClient.stopLEScan();
              } catch (_) {}
              try {
                await performConnection(foundDevice);
              } catch (connErr) {
                console.error("[BLE AUTO] Gagal konek ke scan result:", connErr);
                setConnectionState("disconnected");
              }
            }
          }
        }
      );

      // Batasi scan latar belakang maks 6 detik agar hemat baterai
      setTimeout(async () => {
        try {
          await BleClient.stopLEScan();
        } catch (_) {}
        if (!foundDevice && connectionState !== "connected") {
          setConnectionState("disconnected");
        }
        isAutoConnectingRef.current = false;
      }, 6000);

    } catch (err) {
      console.log("[BLE AUTO] Error auto connect:", err);
      setConnectionState("disconnected");
      isAutoConnectingRef.current = false;
    }
  }, [connectionState, onDisconnected]);

  // Pasang reference autoConnect untuk callback onDisconnected
  useEffect(() => {
    autoConnectRef.current = autoConnect;
  }, [autoConnect]);

  // Auto-connect saat aplikasi pertama kali dibuka (jeda 1.5 detik setelah inisialisasi awal)
  useEffect(() => {
    const startupTimer = setTimeout(() => {
      autoConnect();
    }, 1500);

    return () => {
      clearTimeout(startupTimer);
      if (autoConnectTimerRef.current) clearTimeout(autoConnectTimerRef.current);
    };
  }, [autoConnect]);

  const connect = async () => {
    manualDisconnectRef.current = false;
    if (autoConnectTimerRef.current) clearTimeout(autoConnectTimerRef.current);
    try {
      setConnectionState("connecting");
      addLog({ type: "system", status: "Info", message: "Mencari Perangkat Bluetooth..." });
      
      await BleClient.initialize();

      const selectedDevice = await BleClient.requestDevice({
        services: [SMART_KEY_SERVICE_UUID],
      });
      
      await performConnection(selectedDevice);
    } catch (error) {
      console.error(error);
      setConnectionState("disconnected");
      addLog({ type: "system", status: "Failed", message: `Koneksi gagal: ${(error as Error).message}` });
    }
  };

  const disconnect = useCallback(async () => {
    manualDisconnectRef.current = true;
    if (autoConnectTimerRef.current) clearTimeout(autoConnectTimerRef.current);
    if (deviceId) {
      try {
        await BleClient.disconnect(deviceId);
      } catch (err) {
        console.error(err);
      }
    }
    setConnectionState("disconnected");
    setDeviceId(null);
    addLog({ type: "system", status: "Info", message: "Koneksi diputus secara manual" });
  }, [deviceId, addLog]);

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

  const syncFlashUsers = useCallback(async (): Promise<boolean> => {
    if (connectionState !== "connected") {
      addLog({ type: "system", status: "Warning", message: "Gagal sinkron: Smart Key belum terhubung Bluetooth" });
      return false;
    }
    addLog({ type: "system", status: "Info", message: "Meminta sinkronisasi status Flash memori RP2040..." });
    return await sendCommand("SYNC_FLASH");
  }, [connectionState, sendCommand, addLog]);

  const deleteFlashUser = useCallback(async (slot: number): Promise<boolean> => {
    if (connectionState !== "connected") {
      addLog({ type: "system", status: "Warning", message: "Gagal hapus: Smart Key belum terhubung Bluetooth" });
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
  }, [connectionState, sendCommand, addLog]);

  const formatFlashMemory = useCallback(async (): Promise<boolean> => {
    if (connectionState !== "connected") {
      addLog({ type: "system", status: "Warning", message: "Gagal format: Smart Key belum terhubung Bluetooth" });
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
  }, [connectionState, sendCommand, addLog]);

  return (
    <BLEContext.Provider value={{
      connectionState,
      bleData,
      liveSample,
      logs,
      connect,
      autoConnect,
      disconnect,
      sendCommand,
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
