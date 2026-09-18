import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Bluetooth, Info, Shield, History, X, CheckCircle2, XCircle,
  AlertTriangle, Zap, Activity, HardDrive, Lock, Unlock, KeyRound, BookOpen,
} from "lucide-react";
import { AuthScanPanel } from "./components/AuthScanPanel";
import { RegPanel } from "./components/RegPanel";
import { LogSheet } from "./components/LogSheet";
import { GuidelineDialog } from "./components/GuidelineDialog";
import { EmergencyBypassModal } from "./components/EmergencyBypassModal";
import { SetPinModal } from "./components/SetPinModal";
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
const GYRO_X = "#00C896";
const GYRO_Y = "#2563EB";
const GYRO_Z = "#F59E0B";

const SCAN_FRAMES = [
  { score: "94.5%", vector: "[0.12, -0.05, 0.88]", cov: "[0.04, 0.01]", delta: "+0.05" },
  { score: "91.2%", vector: "[0.14, -0.03, 0.86]", cov: "[0.03, 0.02]", delta: "+0.03" },
  { score: "96.8%", vector: "[0.11, -0.06, 0.90]", cov: "[0.05, 0.01]", delta: "+0.07" },
  { score: "88.4%", vector: "[0.16, -0.02, 0.84]", cov: "[0.06, 0.02]", delta: "+0.02" },
];

const MAX_G = 24;
function gyro(t: number) {
  const n = () => (Math.random() - 0.5) * 0.12;
  return {
    t,
    x: parseFloat((Math.sin(t * 0.28) * 1.4 + Math.sin(t * 0.7) * 0.3 + n()).toFixed(3)),
    y: parseFloat((Math.cos(t * 0.45) * 0.9 + Math.sin(t * 0.2) * 0.4 + n()).toFixed(3)),
    z: parseFloat((Math.sin(t * 0.1) * 0.25 + Math.cos(t * 0.6) * 0.15 + n()).toFixed(3)),
  };
}

export default function App() {
  return (
    <BLEProvider>
      <AppContent />
    </BLEProvider>
  );
}

function AppContent() {
  const { connectionState, bleData, connect, disconnect, sendCommand, resetBleData, addLog } = useBLE();
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [mode, setMode] = useState<"auth" | "training" | null>(null);
  const [doorStatus, setDoorStatus] = useState<"locked" | "unlocked">("locked");
  const [logOpen, setLogOpen] = useState(false);
  const [guidelineOpen, setGuidelineOpen] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [bypassPurpose, setBypassPurpose] = useState<"unlock" | "re_register">("unlock");
  const [setPinOpen, setSetPinOpen] = useState(false);
  const [gyroData, setGyroData] = useState(() => Array.from({ length: MAX_G }, (_, i) => gyro(i)));
  const gyroT = useRef(MAX_G);
  const gyroInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const TOTAL = 10;
  
  // Real progress from BLE
  const progress = bleData.progress || 0;

  // Toggle buka/tutup pintu (Buka pintu diwajibkan menggunakan PIN Bypass)
  const toggleDoor = async () => {
    if (doorStatus === "locked") {
      setBypassPurpose("unlock");
      setEmergencyOpen(true);
    } else {
      setDoorStatus("locked");
      await sendCommand("LOCK_MANUAL");
      addLog({ type: "system", status: "Info", message: "Pintu dikunci manual (LOCKED)" });
    }
  };

  // Side-panel gyro live feed
  useEffect(() => {
    gyroInterval.current = setInterval(() => {
      const t = gyroT.current++;
      setGyroData((prev) => [...prev.slice(-MAX_G + 1), gyro(t)]);
    }, 120);
    return () => { if (gyroInterval.current) clearInterval(gyroInterval.current); };
  }, []);

  const startSession = async (m: "auth" | "training") => {
    if (connectionState !== "connected") {
      alert("Hubungkan ke Smart Key terlebih dahulu!");
      return;
    }
    const cmd = m === "auth" ? "START_AUTH" : "START_REG";
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
      alert("Hubungkan ke Smart Key terlebih dahulu!");
      return;
    }
    const isRegistered = await databaseService.isUserRegistered();
    if (isRegistered) {
      setBypassPurpose("re_register");
      setEmergencyOpen(true);
    } else {
      startSession("training");
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
      // 1. Skenario Registrasi Selesai (10/10)
      if (mode === "training" && progress >= TOTAL) {
        const t = setTimeout(() => {
          setSessionState("success");
          addLog({ type: "reg", status: "Success", message: "Registrasi 10 Jendela Selesai & Tersimpan ke SQLite" });
          // Otomatis buka form pembuatan PIN Bypass setelah selesai
          setTimeout(() => {
            setSetPinOpen(true);
          }, 800);
        }, 500);
        return () => clearTimeout(t);
      } 
      // 2. Skenario Autentikasi Selesai (Bener -> UNLOCKED, Salah -> LOCKED)
      else if (mode === "auth" && (bleData.authStatus === "success" || bleData.authStatus === "failed")) {
        const t = setTimeout(() => {
          setSessionState(bleData.authStatus as SessionState);
          if (bleData.authStatus === "success") {
            setDoorStatus("unlocked");
          } else {
            setDoorStatus("locked");
          }
        }, 400);
        return () => clearTimeout(t);
      }
    }
  }, [bleData.authStatus, sessionState, mode, progress, TOTAL, addLog]);

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
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <button 
            onClick={() => connectionState === 'connected' ? disconnect() : connect()}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full transition-all active:scale-95 cursor-pointer" 
            style={{ 
              background: connectionState === 'connected' ? "#F0FDF4" : connectionState === 'connecting' ? "#FEF3C7" : "#F1F5F9", 
              border: `1px solid ${connectionState === 'connected' ? "#BBF7D0" : connectionState === 'connecting' ? "#FDE68A" : "#E2E8F0"}` 
            }}>
            <span className="relative flex h-2 w-2">
              {connectionState === 'connected' && <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: "#16A34A" }} />}
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: connectionState === 'connected' ? "#16A34A" : connectionState === 'connecting' ? "#D97706" : "#94A3B8" }} />
            </span>
            <Bluetooth size={11} style={{ color: connectionState === 'connected' ? "#16A34A" : connectionState === 'connecting' ? "#D97706" : "#64748B" }} />
            <span style={{ color: connectionState === 'connected' ? "#16A34A" : connectionState === 'connecting' ? "#D97706" : "#64748B", fontFamily: MONO, fontWeight: 600, fontSize: "0.68rem" }}>
              {connectionState === 'connected' ? "Terhubung ke Smart Key" : connectionState === 'connecting' ? "Menghubungkan..." : "Hubungkan BLE"}
            </span>
          </button>
          <div className="flex items-center gap-1.5">
            {[
              { icon: BookOpen, action: () => setGuidelineOpen(true), color: "#2563EB", bg: "#EFF6FF", border: "#BFDBFE", label: "Panduan Sistem (Registrasi & Autentikasi)" },
              { icon: History, action: () => setLogOpen(true), color: "#7C3AED", bg: "#F5F3FF", border: "#DDD6FE", label: "Riwayat Log" },
            ].map(({ icon: Icon, action, color, bg, border, label }) => (
              <button key={label} onClick={action} title={label} className="w-8 h-8 rounded-xl flex items-center justify-center transition-all active:scale-95 cursor-pointer" style={{ background: bg, border: `1px solid ${border}` }}>
                <Icon size={15} style={{ color }} />
              </button>
            ))}
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
            {/* Kartu Tombol Kunci Pintu */}
            <div
              className="bg-white rounded-2xl p-6 flex flex-col items-center justify-center text-center border border-[#E2E8F0] shadow-sm"
            >
              <button
                onClick={toggleDoor}
                className="w-20 h-20 rounded-3xl flex items-center justify-center transition-all active:scale-90 cursor-pointer"
                style={{
                  background: doorStatus === "unlocked" ? "linear-gradient(135deg, #22C55E 0%, #16A34A 100%)" : "#FFFFFF",
                  border: `2px solid ${doorStatus === "unlocked" ? "#16A34A" : "#CBD5E1"}`,
                  boxShadow: doorStatus === "unlocked" ? "0 8px 24px rgba(22,163,74,0.3)" : "0 3px 10px rgba(30,41,59,0.06)",
                  color: doorStatus === "unlocked" ? "#FFFFFF" : "#64748B",
                }}
                title={doorStatus === "unlocked" ? "Ketuk untuk Menutup/Mengunci" : "Ketuk untuk Membuka"}
              >
                {doorStatus === "unlocked" ? <Unlock size={36} /> : <Lock size={36} />}
              </button>

              <div className="mt-3.5 flex flex-col items-center text-center">
                <span
                  className="px-3.5 py-1 rounded-full text-[0.65rem] font-bold tracking-wider inline-block transition-colors"
                  style={{
                    background: doorStatus === "unlocked" ? "#DCFCE7" : "#FEE2E2",
                    color: doorStatus === "unlocked" ? "#15803D" : "#B91C1C",
                    border: `1px solid ${doorStatus === "unlocked" ? "#BBF7D0" : "#FECACA"}`,
                    fontFamily: MONO,
                  }}
                >
                  {doorStatus === "unlocked" ? "UNLOCKED (TERBUKA)" : "LOCKED (TERKUNCI)"}
                </span>
                <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.62rem", marginTop: 4 }}>
                  {doorStatus === "unlocked" ? "Ketuk ikon untuk menutup / mengunci" : "Ketuk ikon untuk membuka pintu"}
                </p>
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
                    {sessionState === "success" ? (mode === "auth" ? "IDENTITAS TERVERIFIKASI" : "PENDAFTARAN BERHASIL") : "AUTENTIKASI GAGAL"}
                  </p>
                  <p className="mt-1" style={{ color: "#64748B", fontFamily: SANS, fontSize: "0.75rem" }}>
                    {sessionState === "success" ? (mode === "auth" ? "Akses ke Smart Key diberikan." : "Profil gaya berjalan telah tersimpan.") : "Skor kepercayaan di bawah ambang batas."}
                  </p>
                  {mode === "training" && sessionState === "success" && (
                    <button
                      onClick={() => {
                        dismiss();
                        setSetPinOpen(true);
                      }}
                      className="mt-3 w-full py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer shadow-sm"
                      style={{ background: "#2563EB", color: "#FFFFFF", fontFamily: MONO, fontSize: "0.68rem", fontWeight: 700 }}
                    >
                      <KeyRound size={14} />
                      <span>BUAT PIN BYPASS SEKARANG</span>
                    </button>
                  )}
                  <button onClick={dismiss} className="mt-3 px-6 py-2 rounded-xl transition-all active:scale-95" style={{ background: "#FFFFFF", border: `1px solid ${sessionState === "success" ? "#BBF7D0" : "#FECACA"}`, color: sessionState === "success" ? "#16A34A" : "#DC2626", fontFamily: MONO, fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.08em" }}>
                    TUTUP
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Kolom Kanan: Panel Status Pemindaian & Diagnostik */}
          <div className="flex flex-col gap-4">
            {!isResult && (
              mode === "training"
                ? <RegPanel isScanning={isScanning} progress={progress} total={TOTAL} />
                : <AuthScanPanel isScanning={isScanning} progress={progress} total={TOTAL} diagScore={bleData.score} diagVector={bleData.vector} diagCov={bleData.cov} diagDelta={bleData.delta} />
            )}

            {!isResult && !isScanning && mode === null && (
              <div className="rounded-2xl p-6 flex flex-col items-center justify-center text-center bg-white border border-[#E2E8F0] shadow-sm min-h-[220px]">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3 bg-[#F1F5F9] border border-[#E2E8F0]">
                  <Shield size={26} style={{ color: "#94A3B8" }} />
                </div>
                <p style={{ color: "#1E293B", fontFamily: SANS, fontSize: "0.85rem", fontWeight: 600 }}>Pilih operasi di bawah untuk memulai</p>
                <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.65rem", marginTop: 4 }}>AUTENTIKASI ATAU REGISTRASI</p>
              </div>
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
            {/* Mulai Autentikasi */}
            <button
              onClick={() => !isScanning && startSession("auth")}
              disabled={isScanning}
              className="w-full rounded-2xl py-3.5 px-4 flex items-center justify-center gap-2.5 transition-all active:scale-[0.98]"
              style={{
                background: isScanning ? "#F1F5F9" : "linear-gradient(135deg,#16A34A,#15803D)",
                cursor: isScanning ? "not-allowed" : "pointer",
                boxShadow: isScanning ? "none" : "0 4px 16px rgba(22,163,74,0.28)",
              }}
            >
              <Shield size={16} style={{ color: isScanning ? "#CBD5E1" : "#FFF" }} />
              <span style={{ color: isScanning ? "#CBD5E1" : "#FFF", fontFamily: MONO, fontWeight: 700, fontSize: "0.78rem", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Mulai Autentikasi
              </span>
            </button>

            {/* Mulai Registrasi */}
            <button
              onClick={() => !isScanning && handleStartRegistration()}
              disabled={isScanning}
              className="w-full rounded-2xl py-3.5 px-4 flex items-center justify-center gap-2.5 transition-all active:scale-[0.98]"
              style={{ background: "transparent", border: `1.5px solid ${isScanning ? "#E2E8F0" : "#BFDBFE"}`, cursor: isScanning ? "not-allowed" : "pointer" }}
            >
              <Info size={16} style={{ color: isScanning ? "#CBD5E1" : "#2563EB" }} />
              <span style={{ color: isScanning ? "#CBD5E1" : "#2563EB", fontFamily: MONO, fontWeight: 600, fontSize: "0.78rem", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Mulai Registrasi
              </span>
            </button>
          </div>

          {/* Emergency Bypass & Manual Control */}
          {!isScanning && (
            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={() => {
                  setBypassPurpose("unlock");
                  setEmergencyOpen(true);
                }}
                className="w-full rounded-xl py-2.5 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                style={{ background: TEAL_BG, border: `1.5px solid ${TEAL_BORDER}` }}
              >
                <Zap size={14} style={{ color: TEAL_DIM }} />
                <span style={{ color: TEAL_DIM, fontFamily: MONO, fontWeight: 700, fontSize: "0.7rem", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  Bypass
                </span>
              </button>
              <button
                onClick={toggleDoor}
                className="w-full rounded-xl py-2.5 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                style={{
                  background: doorStatus === "unlocked" ? "#F0FDF4" : "#FEF2F2",
                  border: `1.5px solid ${doorStatus === "unlocked" ? "#BBF7D0" : "#FECACA"}`,
                }}
              >
                {doorStatus === "unlocked" ? (
                  <>
                    <Lock size={14} style={{ color: "#16A34A" }} />
                    <span style={{ color: "#16A34A", fontFamily: MONO, fontWeight: 700, fontSize: "0.7rem", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                      Kunci Pintu
                    </span>
                  </>
                ) : (
                  <>
                    <Unlock size={14} style={{ color: "#DC2626" }} />
                    <span style={{ color: "#DC2626", fontFamily: MONO, fontWeight: 700, fontSize: "0.7rem", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                      Buka Pintu
                    </span>
                  </>
                )}
              </button>
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
        onUnlock={() => setDoorStatus("unlocked")}
        onVerified={() => startSession("training")}
      />
      <SetPinModal
        open={setPinOpen}
        onClose={() => setSetPinOpen(false)}
        onSuccess={() => {
          addLog({ type: "system", status: "Success", message: "PIN Bypass Darurat Baru Aktif" });
        }}
      />
    </div>
  );
}
