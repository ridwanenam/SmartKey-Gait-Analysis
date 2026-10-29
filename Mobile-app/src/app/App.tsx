import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Bluetooth, Info, Shield, History, X, CheckCircle2, XCircle,
  AlertTriangle, Zap, Activity, HardDrive, Lock, Unlock, KeyRound, BookOpen, Terminal, GitCompare,
} from "lucide-react";
import { AuthScanPanel } from "./components/AuthScanPanel";
import { RegPanel } from "./components/RegPanel";
import { IdlePanel } from "./components/IdlePanel";
import { LogSheet } from "./components/LogSheet";
import { GuidelineDialog } from "./components/GuidelineDialog";
import { EmergencyBypassModal } from "./components/EmergencyBypassModal";
import { RegisterUserModal } from "./components/RegisterUserModal";
import { SetPinModal } from "./components/SetPinModal";
import { PinSettingsModal } from "./components/PinSettingsModal";
import { GaitComparisonModal } from "./components/GaitComparisonModal";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { BLEProvider, useBLE } from "./context/BLEContext";
import { databaseService } from "./services/databaseService";

type SessionState = "idle" | "scanning" | "success" | "failed";

const MONO = "JetBrains Mono, monospace";
const SANS = "Inter, sans-serif";
const TEAL = "#00F0A0";
const TEAL_DIM = "#0D9488";
const TEAL_BG = "#F0FFFB";
const TEAL_BORDER = "#A7F3D0";

export default function App() {
  return (
    <BLEProvider>
      <AppContent />
    </BLEProvider>
  );
}

function AppContent() {
  const {
    connectionState,
    wearableState,
    doorLockState,
    isDoorUnlocked,
    bleData,
    liveSample,
    setBleData,
    connect,
    connectWearable,
    connectDoorLock,
    disconnect,
    disconnectWearable,
    disconnectDoorLock,
    sendCommand,
    sendDoorCommand,
    resetBleData,
    addLog,
    setActiveSession,
    recordStepTelemetry,
    verifiedUserName,
    flashSyncVersion,
  } = useBLE();
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [hasRegisteredUser, setHasRegisteredUser] = useState(false);
  const [mode, setMode] = useState<"auth" | "training" | null>(null);
  const [doorStatus, setDoorStatus] = useState<"locked" | "unlocked">("locked");
  const [logOpen, setLogOpen] = useState(false);
  const [guidelineOpen, setGuidelineOpen] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [bypassPurpose, setBypassPurpose] = useState<"unlock" | "re_register">("unlock");
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [setPinOpen, setSetPinOpen] = useState(false);
  const [pinSettingsOpen, setPinSettingsOpen] = useState(false);
  const [currentBypassPin, setCurrentBypassPin] = useState("123456");
  const [isDevMode, setIsDevMode] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);

  // Ambil PIN Bypass dan periksa ketersediaan user terdaftar dari SQLite
  useEffect(() => {
    databaseService.getBypassPin().then((pin) => {
      if (pin) setCurrentBypassPin(pin);
    });
    databaseService.isUserRegistered().then((reg) => {
      setHasRegisteredUser(reg);
    });
  }, [flashSyncVersion, sessionState]);

  const TOTAL = 5;
  
  // Real progress from BLE
  const progress = bleData.progress || 0;

  // Sinkronisasi status pintu fisik secara real-time dari notifikasi ESP32
  useEffect(() => {
    setDoorStatus(isDoorUnlocked ? "unlocked" : "locked");
  }, [isDoorUnlocked]);

  // Toggle buka/tutup pintu (Buka pintu diwajibkan menggunakan PIN Bypass & BLE aktif)
  const toggleDoor = async () => {
    if (doorLockState !== "connected" && connectionState !== "connected") {
      alert("Smart Key belum terhubung via Bluetooth!\n\nKunci pintu solenoid fisik hanya dapat dikontrol saat terhubung ke perangkat BLE.");
      return;
    }
    if (doorStatus === "locked") {
      setBypassPurpose("unlock");
      setEmergencyOpen(true);
    } else {
      setDoorStatus("locked");
      await sendDoorCommand("CLOSE_DOOR");
      addLog({ type: "system", status: "Info", message: "Pintu dikunci manual (LOCKED)" });
    }
  };

  // Guard krusial: Jika koneksi BLE terputus saat proses autentikasi atau registrasi sedang berjalan,
  // paksa (force) kembali ke idle mode secara instan dan bersihkan data sesi aktif.
  // Selain itu, pastikan status pintu kembali ke locked (failsafe solenoid pintu).
  useEffect(() => {
    if (connectionState !== "connected") {
      if (sessionState === "scanning" || mode !== null) {
        setSessionState("idle");
        setMode(null);
        resetBleData();
        addLog({
          type: "system",
          status: "Warning",
          message: "Koneksi Smart Key BLE terputus saat proses berjalan. Sesi aktif dibatalkan secara otomatis ke Idle mode.",
        });
      }
      if (doorStatus === "unlocked") {
        setDoorStatus("locked");
        addLog({
          type: "system",
          status: "Info",
          message: "Koneksi BLE terputus: Status pintu dikembalikan ke Terkunci (Failsafe LOCKED).",
        });
      }
    }
  }, [connectionState, sessionState, mode, doorStatus, resetBleData, addLog]);

  const startSession = async (m: "auth" | "training") => {
    if (connectionState !== "connected") {
      alert("Smart Key belum terhubung via Bluetooth!\n\nPastikan perangkat BLE aktif dan terhubung sebelum memulai.");
      return;
    }
    const profiles = await databaseService.getUserProfiles();
    const defaultName = profiles.length > 0 ? profiles[0].name : "User 1";
    setActiveSession({ mode: m, slot: 0, name: defaultName });
    const cmd = m === "auth" ? "START_AUTH" : `TRAIN:0:${defaultName}`;
    const success = await sendCommand(cmd);
    if (success) {
      setMode(m);
      setSessionState("scanning");
      resetBleData();
    }
  };

  // Mulai registrasi dengan proteksi PIN jika sudah pernah terdaftar
  const handleStartRegistration = async () => {
    if (connectionState !== "connected") {
      alert("Smart Key belum terhubung via Bluetooth!\n\nPastikan perangkat BLE aktif dan terhubung sebelum memulai registrasi.");
      return;
    }
    const isRegistered = await databaseService.isUserRegistered();
    if (isRegistered) {
      // Guard PIN 1x di awal untuk memastikan pemilik sah
      setBypassPurpose("re_register");
      setEmergencyOpen(true);
    } else {
      // Jika belum ada yang terdaftar, langsung buka dialog slot & nama
      setRegisterModalOpen(true);
    }
  };

  const startRegistrationSession = async (slot: number, name: string) => {
    setRegisterModalOpen(false);
    if (connectionState !== "connected") {
      alert("Smart Key belum terhubung via Bluetooth!\n\nTidak dapat memulai sesi registrasi tanpa koneksi BLE.");
      return;
    }
    setActiveSession({ mode: "training", slot, name });

    const success = await sendCommand(`TRAIN:${slot}:${name}`);
    if (success) {
      setMode("training");
      setSessionState("scanning");
      resetBleData();
    }
  };

  const cancelSession = async () => {
    if (connectionState === "connected") {
      await sendCommand("CANCEL");
    }
    setSessionState("idle"); 
    setMode(null); 
    resetBleData();
  };
  
  const dismiss = () => { setSessionState("idle"); setMode(null); resetBleData(); };

  // Perbaikan bug mancet 10/10 dan trigger status kunci pintu
  useEffect(() => {
    if (sessionState === "scanning") {
      // 1. Skenario Registrasi Selesai (5/5)
      if (mode === "training" && progress >= TOTAL) {
        const t = setTimeout(() => {
          setSessionState("success");
          addLog({ type: "reg", status: "Success", message: "Registrasi 5 Jendela Selesai & Tersimpan ke Flash / SQLite" });
          // TIDAK memunculkan popup PIN lagi, data langsung tersimpan aman
        }, 500);
        return () => clearTimeout(t);
      } 
      // 2. Skenario Autentikasi Selesai (Bener -> UNLOCKED, Salah -> LOCKED)
      else if (mode === "auth" && (progress >= TOTAL || bleData.authStatus === "success" || bleData.authStatus === "failed")) {
        const finalStatus = (bleData.authStatus === "success" || (progress >= TOTAL && bleData.telemetry.confidenceScore >= 80.0)) ? "success" : "failed";
        const t = setTimeout(() => {
          setSessionState(finalStatus);
          if (finalStatus === "success" && connectionState === "connected") {
            setDoorStatus("unlocked");
          } else {
            setDoorStatus("locked");
          }
        }, 400);
        return () => clearTimeout(t);
      }
    }
  }, [bleData.authStatus, bleData.telemetry.confidenceScore, sessionState, mode, progress, TOTAL, connectionState, addLog]);

  const isScanning = sessionState === "scanning";
  const isResult = sessionState === "success" || sessionState === "failed";

  return (
    <div
      className="w-full h-[100dvh] flex flex-col overflow-hidden select-none"
      style={{ background: "#F8FAFC", fontFamily: SANS }}
    >
      {/* ── HEADER ───────────────────────────────────── */}
      <header
        className="w-full shrink-0 border-b border-[#EEF2F7] bg-white z-20"
        style={{
          paddingTop: "max(env(safe-area-inset-top), 14px)",
          paddingLeft: "max(env(safe-area-inset-left), 16px)",
          paddingRight: "max(env(safe-area-inset-right), 16px)",
          paddingBottom: "12px",
        }}
      >
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-2">
          {/* Dual BLE Hub Status Pills (Wearable RP2040 & Door Lock ESP32) */}
          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
            {/* 1. Status Wearable (Arduino RP2040) */}
            <button 
              type="button"
              onClick={() => wearableState === 'connected' ? disconnectWearable() : connectWearable()}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-all active:scale-95 cursor-pointer shrink-0" 
              title="Status Koneksi Arduino Wearable (IMU & Biometrik Gait)"
              style={{ 
                background: wearableState === 'connected' ? "#F0FDF4" : wearableState === 'connecting' ? "#FEF3C7" : "#F1F5F9", 
                border: `1px solid ${wearableState === 'connected' ? "#BBF7D0" : wearableState === 'connecting' ? "#FDE68A" : "#E2E8F0"}` 
              }}>
              <span className="relative flex h-1.5 w-1.5">
                {wearableState === 'connected' && <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: "#16A34A" }} />}
                <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: wearableState === 'connected' ? "#16A34A" : wearableState === 'connecting' ? "#D97706" : "#94A3B8" }} />
              </span>
              <Activity size={10} style={{ color: wearableState === 'connected' ? "#16A34A" : wearableState === 'connecting' ? "#D97706" : "#64748B" }} />
              <span style={{ color: wearableState === 'connected' ? "#16A34A" : wearableState === 'connecting' ? "#D97706" : "#64748B", fontFamily: MONO, fontWeight: 700, fontSize: "0.62rem" }}>
                {wearableState === 'connected' ? "Wearable" : wearableState === 'connecting' ? "RP2040..." : "Wearable: Off"}
              </span>
            </button>

            {/* 2. Status Smart Door Lock (ESP32) */}
            <button 
              type="button"
              onClick={() => doorLockState === 'connected' ? disconnectDoorLock() : connectDoorLock()}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-all active:scale-95 cursor-pointer shrink-0" 
              title="Status Koneksi ESP32 Smart Door Lock (Solenoid Kunci Pintu)"
              style={{ 
                background: doorLockState === 'connected' ? "#F0FDF4" : doorLockState === 'connecting' ? "#FEF3C7" : "#F1F5F9", 
                border: `1px solid ${doorLockState === 'connected' ? "#BBF7D0" : doorLockState === 'connecting' ? "#FDE68A" : "#E2E8F0"}` 
              }}>
              <span className="relative flex h-1.5 w-1.5">
                {doorLockState === 'connected' && <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: "#16A34A" }} />}
                <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: doorLockState === 'connected' ? "#16A34A" : doorLockState === 'connecting' ? "#D97706" : "#94A3B8" }} />
              </span>
              <Lock size={10} style={{ color: doorLockState === 'connected' ? "#16A34A" : doorLockState === 'connecting' ? "#D97706" : "#64748B" }} />
              <span style={{ color: doorLockState === 'connected' ? "#16A34A" : doorLockState === 'connecting' ? "#D97706" : "#64748B", fontFamily: MONO, fontWeight: 700, fontSize: "0.62rem" }}>
                {doorLockState === 'connected' ? "Door Lock" : doorLockState === 'connecting' ? "ESP32..." : "Door: Off"}
              </span>
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            {[
              { icon: BookOpen, action: () => setGuidelineOpen(true), color: "#2563EB", bg: "#EFF6FF", border: "#BFDBFE", label: "Panduan Sistem" },
              { icon: KeyRound, action: () => setPinSettingsOpen(true), color: TEAL_DIM, bg: TEAL_BG, border: TEAL_BORDER, label: "Pengaturan PIN Bypass" },
              { icon: History, action: () => setLogOpen(true), color: "#7C3AED", bg: "#F5F3FF", border: "#DDD6FE", label: "Riwayat Log" },
              { icon: GitCompare, action: () => setComparisonOpen(true), color: "#0D9488", bg: "#F0FDFA", border: "#99F6E4", label: "Komparasi Gait (PR Diff)" },
            ].map(({ icon: Icon, action, color, bg, border, label }) => (
              <button key={label} onClick={action} title={label} className="w-8 h-8 rounded-xl flex items-center justify-center transition-all active:scale-95 cursor-pointer" style={{ background: bg, border: `1px solid ${border}` }}>
                <Icon size={15} style={{ color }} />
              </button>
            ))}
            {/* Developer Mode Toggle Button */}
            <button
              onClick={() => setIsDevMode(prev => !prev)}
              title={isDevMode ? "Mode Pengembang Aktif (Ketuk untuk Mematikan)" : "Aktifkan Mode Pengembang / Diagnostik"}
              className="w-8 h-8 rounded-xl flex items-center justify-center transition-all active:scale-95 cursor-pointer"
              style={{
                background: isDevMode ? "#FEF3C7" : "#F1F5F9",
                border: `1px solid ${isDevMode ? "#FCD34D" : "#E2E8F0"}`,
                boxShadow: isDevMode ? "0 0 8px rgba(245,158,11,0.25)" : "none",
              }}
            >
              <Terminal size={15} style={{ color: isDevMode ? "#D97706" : "#64748B" }} />
            </button>
          </div>
        </div>
      </header>

      {/* ── CENTER SCROLLABLE AREA (ADAPTIVE 2-COL ON TABLET) ── */}
      <main
        className="flex-1 w-full overflow-y-auto"
        style={{
          paddingLeft: "max(env(safe-area-inset-left), 16px)",
          paddingRight: "max(env(safe-area-inset-right), 16px)",
          paddingTop: "16px",
          paddingBottom: "16px",
        }}
      >
        <div className="max-w-4xl mx-auto flex flex-col md:grid md:grid-cols-2 md:gap-6 md:items-start gap-4">
          {/* Kolom Kiri: Kontrol Pintu & Banner Hasil */}
          <div className="flex flex-col gap-4">
            {/* Kartu Tombol Kunci Pintu (Compact) */}
            <div
              className="bg-white rounded-2xl p-3.5 px-4 flex items-center justify-between border border-[#E2E8F0] shadow-2xs"
            >
              <div className="flex items-center gap-3">
                <button
                  onClick={toggleDoor}
                  className="w-13 h-13 rounded-2xl flex items-center justify-center transition-all active:scale-90 cursor-pointer shrink-0"
                  style={{
                    background: doorStatus === "unlocked" ? "linear-gradient(135deg, #22C55E 0%, #16A34A 100%)" : "#FFFFFF",
                    border: `1.5px solid ${doorStatus === "unlocked" ? "#16A34A" : "#CBD5E1"}`,
                    boxShadow: doorStatus === "unlocked" ? "0 4px 14px rgba(22,163,74,0.25)" : "0 2px 6px rgba(30,41,59,0.05)",
                    color: doorStatus === "unlocked" ? "#FFFFFF" : "#64748B",
                  }}
                  title={doorStatus === "unlocked" ? "Ketuk untuk Menutup/Mengunci" : "Ketuk untuk Membuka"}
                >
                  {doorStatus === "unlocked" ? <Unlock size={24} /> : <Lock size={24} />}
                </button>

                <div className="flex flex-col">
                  <div>
                    <span
                      className="px-2.5 py-0.5 rounded-full text-[0.6rem] font-bold tracking-wider inline-block transition-colors"
                      style={{
                        background: doorStatus === "unlocked" ? "#DCFCE7" : "#FEE2E2",
                        color: doorStatus === "unlocked" ? "#15803D" : "#B91C1C",
                        border: `1px solid ${doorStatus === "unlocked" ? "#BBF7D0" : "#FECACA"}`,
                        fontFamily: MONO,
                      }}
                    >
                      {doorStatus === "unlocked" ? "UNLOCKED (TERBUKA)" : "LOCKED (TERKUNCI)"}
                    </span>
                  </div>
                  <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.58rem", marginTop: 3 }}>
                    {doorStatus === "unlocked" ? "Ketuk ikon untuk mengunci pintu" : "Ketuk ikon untuk membuka via PIN"}
                  </p>
                </div>
              </div>

              <div className="hidden sm:flex items-center text-right">
                <span className="px-2 py-1 rounded bg-slate-50 border border-slate-200" style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.55rem" }}>
                  FAIL-SAFE READY
                </span>
              </div>
            </div>

            {/* Banner Hasil Sesi */}
            <AnimatePresence>
              {isResult && (
                <motion.div
                  className="rounded-2xl p-6 flex flex-col items-center text-center shadow-sm"
                  style={{ background: sessionState === "success" ? "#F0FDF4" : "#FEF2F2", border: `1px solid ${sessionState === "success" ? "#BBF7D0" : "#FECACA"}` }}
                  initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                >
                  {sessionState === "success" ? <CheckCircle2 size={44} style={{ color: "#16A34A" }} /> : <XCircle size={44} style={{ color: "#DC2626" }} />}
                  <p className="mt-3" style={{ color: sessionState === "success" ? "#15803D" : "#B91C1C", fontFamily: MONO, fontWeight: 700, fontSize: "0.78rem", letterSpacing: "0.06em" }}>
                    {sessionState === "success"
                      ? (mode === "auth"
                          ? (verifiedUserName && verifiedUserName !== "PIN_BYPASS"
                              ? `IDENTITAS ${verifiedUserName.toUpperCase()} TERVERIFIKASI`
                              : "IDENTITAS TERVERIFIKASI")
                          : "PENDAFTARAN BERHASIL")
                      : "AUTENTIKASI GAGAL"}
                  </p>
                  <p className="mt-1" style={{ color: "#64748B", fontFamily: SANS, fontSize: "0.75rem" }}>
                    {sessionState === "success"
                      ? (mode === "auth"
                          ? (verifiedUserName && verifiedUserName !== "PIN_BYPASS"
                              ? `Akses diberikan kepada ${verifiedUserName}. Pintu terbuka.`
                              : "Akses ke Smart Key diberikan. Pintu terbuka.")
                          : "Profil gaya berjalan telah tersimpan di Flash & SQLite.")
                      : "Skor kepercayaan di bawah ambang batas CIR 80%."}
                  </p>
                  <button onClick={dismiss} className="mt-4 px-6 py-2 rounded-xl transition-all active:scale-95 cursor-pointer" style={{ background: "#FFFFFF", border: `1px solid ${sessionState === "success" ? "#BBF7D0" : "#FECACA"}`, color: sessionState === "success" ? "#16A34A" : "#DC2626", fontFamily: MONO, fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.08em" }}>
                    TUTUP
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Kolom Kanan: Panel Status Pemindaian & Diagnostik */}
          <div className="flex flex-col gap-4">
            {!isResult && (
              mode === "training" ? (
                <RegPanel
                  isScanning={isScanning}
                  progress={progress}
                  total={TOTAL}
                  telemetry={bleData.telemetry}
                  liveSample={liveSample}
                  isDevMode={isDevMode}
                />
              ) : mode === "auth" ? (
                <AuthScanPanel
                  isScanning={isScanning}
                  progress={progress}
                  total={TOTAL}
                  diagScore={bleData.score}
                  diagVector={bleData.vector}
                  diagCov={bleData.cov}
                  diagDelta={bleData.delta}
                  telemetry={bleData.telemetry}
                  liveSample={liveSample}
                  isDevMode={isDevMode}
                />
              ) : (
                <IdlePanel isConnected={connectionState === "connected"} isDevMode={isDevMode} />
              )
            )}
          </div>
        </div>
      </main>

      {/* ── BOTTOM CONTROLS (RESPONSIVE ROW/COL) ──────── */}
      <footer
        className="w-full shrink-0 border-t border-[#EEF2F7] bg-white z-20"
        style={{
          paddingTop: "12px",
          paddingBottom: "max(env(safe-area-inset-bottom), 16px)",
          paddingLeft: "max(env(safe-area-inset-left), 16px)",
          paddingRight: "max(env(safe-area-inset-right), 16px)",
        }}
      >
        <div className="max-w-4xl mx-auto flex flex-col gap-2.5">
          {/* Main Action Buttons: 2 columns on tablet, 1 column on phone */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {/* Mulai Autentikasi (Dinonaktifkan jika belum connect BLE atau Flash kosong) */}
            <button
              onClick={() => {
                if (connectionState !== "connected") {
                  alert(
                    "Smart Key belum terhubung via Bluetooth!\n\nKetuk tombol status Bluetooth di pojok kiri atas untuk menghubungkan ke RP2040 terlebih dahulu."
                  );
                  return;
                }
                if (!hasRegisteredUser) {
                  alert(
                    "Perhatian: Belum ada profil pengguna terdaftar di memori Flash RP2040!\n\nSilakan lakukan registrasi terlebih dahulu dengan mengetuk tombol 'Mulai Registrasi' di samping."
                  );
                  return;
                }
                if (!isScanning) startSession("auth");
              }}
              disabled={isScanning || !hasRegisteredUser || connectionState !== "connected"}
              className="w-full rounded-2xl py-3.5 px-4 flex items-center justify-center gap-2.5 transition-all active:scale-[0.98]"
              style={{
                background: (connectionState !== "connected" || !hasRegisteredUser)
                  ? "#F8FAFC"
                  : isScanning
                  ? "#F1F5F9"
                  : "linear-gradient(135deg,#16A34A,#15803D)",
                border: (connectionState !== "connected" || !hasRegisteredUser) ? "1.5px dashed #CBD5E1" : "none",
                cursor: (connectionState !== "connected" || !hasRegisteredUser || isScanning) ? "not-allowed" : "pointer",
                boxShadow: (connectionState !== "connected" || !hasRegisteredUser || isScanning) ? "none" : "0 4px 16px rgba(22,163,74,0.28)",
              }}
              title={
                connectionState !== "connected"
                  ? "Hubungkan Bluetooth terlebih dahulu"
                  : !hasRegisteredUser
                  ? "Daftarkan profil gait pengguna terlebih dahulu"
                  : "Mulai autentikasi gaya berjalan"
              }
            >
              <Shield size={16} style={{ color: (connectionState !== "connected" || !hasRegisteredUser || isScanning) ? "#94A3B8" : "#FFF" }} />
              <span style={{
                color: (connectionState !== "connected" || !hasRegisteredUser || isScanning) ? "#94A3B8" : "#FFF",
                fontFamily: MONO,
                fontWeight: 700,
                fontSize: "0.78rem",
                letterSpacing: "0.08em",
                textTransform: "uppercase"
              }}>
                {connectionState !== "connected"
                  ? "Mulai Autentikasi (Hubungkan BLE)"
                  : !hasRegisteredUser
                  ? "Mulai Autentikasi (Daftar Dulu)"
                  : "Mulai Autentikasi"}
              </span>
            </button>

            {/* Mulai Registrasi */}
            <button
              onClick={() => {
                if (connectionState !== "connected") {
                  alert(
                    "Smart Key belum terhubung via Bluetooth!\n\nKetuk tombol status Bluetooth di pojok kiri atas untuk menghubungkan ke RP2040 terlebih dahulu."
                  );
                  return;
                }
                if (!isScanning) handleStartRegistration();
              }}
              disabled={isScanning || connectionState !== "connected"}
              className="w-full rounded-2xl py-3.5 px-4 flex items-center justify-center gap-2.5 transition-all active:scale-[0.98]"
              style={{
                background: "transparent",
                border: `1.5px solid ${isScanning || connectionState !== "connected" ? "#E2E8F0" : "#BFDBFE"}`,
                cursor: isScanning || connectionState !== "connected" ? "not-allowed" : "pointer"
              }}
              title={connectionState !== "connected" ? "Hubungkan Bluetooth terlebih dahulu" : "Mulai registrasi profil gaya berjalan baru"}
            >
              <Info size={16} style={{ color: isScanning || connectionState !== "connected" ? "#CBD5E1" : "#2563EB" }} />
              <span style={{
                color: isScanning || connectionState !== "connected" ? "#CBD5E1" : "#2563EB",
                fontFamily: MONO,
                fontWeight: 600,
                fontSize: "0.78rem",
                letterSpacing: "0.08em",
                textTransform: "uppercase"
              }}>
                {connectionState !== "connected" ? "Mulai Registrasi (Hubungkan BLE)" : "Mulai Registrasi"}
              </span>
            </button>
          </div>

          {/* Emergency Bypass & Manual Lock Control */}
          {!isScanning && (
            <div className="w-full">
              {doorStatus === "locked" ? (
                <button
                  onClick={() => {
                    if (connectionState !== "connected") {
                      alert("Smart Key belum terhubung via Bluetooth!\n\nKunci pintu solenoid fisik hanya dapat dibuka saat terhubung ke perangkat BLE.");
                      return;
                    }
                    setBypassPurpose("unlock");
                    setEmergencyOpen(true);
                  }}
                  disabled={connectionState !== "connected"}
                  className="w-full rounded-2xl py-3.5 px-4 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                  style={{
                    background: connectionState !== "connected" ? "#F8FAFC" : TEAL_BG,
                    border: `1.5px solid ${connectionState !== "connected" ? "#E2E8F0" : TEAL_BORDER}`,
                    cursor: connectionState !== "connected" ? "not-allowed" : "pointer",
                    opacity: connectionState !== "connected" ? 0.6 : 1,
                  }}
                  title={connectionState !== "connected" ? "Hubungkan Bluetooth terlebih dahulu" : "Buka Pintu Menggunakan PIN Emergency Bypass"}
                >
                  <Zap size={15} style={{ color: connectionState !== "connected" ? "#94A3B8" : TEAL_DIM }} />
                  <span style={{ color: connectionState !== "connected" ? "#94A3B8" : TEAL_DIM, fontFamily: MONO, fontWeight: 700, fontSize: "0.75rem", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    {connectionState !== "connected" ? "Bypass PIN (Hubungkan BLE)" : "Bypass (PIN Buka Pintu)"}
                  </span>
                </button>
              ) : (
                <button
                  onClick={toggleDoor}
                  className="w-full rounded-2xl py-3.5 px-4 flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer"
                  style={{
                    background: "#FEF2F2",
                    border: "1.5px solid #FECACA",
                  }}
                  title="Kunci Pintu Rumah Kembali"
                >
                  <Lock size={15} style={{ color: "#DC2626" }} />
                  <span style={{ color: "#DC2626", fontFamily: MONO, fontWeight: 700, fontSize: "0.75rem", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    Kunci Pintu Sekarang
                  </span>
                </button>
              )}
            </div>
          )}

          {/* Batalkan Sesi */}
          <AnimatePresence>
            {isScanning && (
              <motion.button
                onClick={cancelSession}
                className="w-full rounded-xl py-2.5 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                style={{ background: "#FEF2F2", border: "1px solid #FECACA" }}
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
              >
                <X size={13} style={{ color: "#DC2626" }} />
                <span style={{ color: "#DC2626", fontFamily: MONO, fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  Batalkan Sesi Aktif
                </span>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </footer>

      {/* ── OVERLAYS ─────────────────────────────────── */}
      <LogSheet open={logOpen} onClose={() => setLogOpen(false)} />
      <GuidelineDialog open={guidelineOpen} onClose={() => setGuidelineOpen(false)} />
      <EmergencyBypassModal
        open={emergencyOpen}
        onClose={() => setEmergencyOpen(false)}
        purpose={bypassPurpose}
        correctPin={currentBypassPin}
        onUnlock={() => {
          if (connectionState === "connected") {
            setDoorStatus("unlocked");
          } else {
            alert("Smart Key belum terhubung via Bluetooth! Pintu fisik tetap terkunci.");
          }
        }}
        onVerified={() => {
          setEmergencyOpen(false);
          setRegisterModalOpen(true);
        }}
      />
      <RegisterUserModal
        open={registerModalOpen}
        onClose={() => setRegisterModalOpen(false)}
        onStart={startRegistrationSession}
      />
      <SetPinModal
        open={setPinOpen}
        onClose={() => setSetPinOpen(false)}
        onSuccess={(newPin) => {
          setCurrentBypassPin(newPin);
          addLog({ type: "system", status: "Success", message: `PIN Bypass Baru (${newPin}) Berhasil Disimpan ke SQLite` });
        }}
      />
      <PinSettingsModal
        open={pinSettingsOpen}
        onClose={() => setPinSettingsOpen(false)}
        currentPin={currentBypassPin}
        onSuccess={(newPin) => {
          setCurrentBypassPin(newPin);
          addLog({ type: "system", status: "Success", message: `PIN Bypass Berhasil Diubah ke: ${newPin}` });
        }}
      />
      <GaitComparisonModal
        open={comparisonOpen}
        onClose={() => setComparisonOpen(false)}
      />
    </div>
  );
}
