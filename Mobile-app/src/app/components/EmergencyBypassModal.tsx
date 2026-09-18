import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Delete, CheckCircle2, XCircle, Zap, Clock, RotateCcw } from "lucide-react";
import { useBLE } from "../context/BLEContext";
import { databaseService } from "../services/databaseService";

type BypassState = "input" | "verifying" | "success" | "failed";

interface EmergencyBypassModalProps {
  open: boolean;
  onClose: () => void;
  onUnlock?: () => void;
  purpose?: "unlock" | "re_register";
  onVerified?: () => void;
}

const MONO = "JetBrains Mono, monospace";
const SANS = "Inter, sans-serif";
const TEAL = "#00F0A0";
const TEAL_BG = "#F0FFFB";
const TEAL_BORDER = "#A7F3D0";

const PAD_KEYS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["", "0", "DEL"],
];

export function EmergencyBypassModal({
  open,
  onClose,
  onUnlock,
  purpose = "unlock",
  onVerified,
}: EmergencyBypassModalProps) {
  const { sendCommand, addLog } = useBLE();
  const [pin, setPin] = useState("");
  const [bypassState, setBypassState] = useState<BypassState>("input");
  const [shakeKey, setShakeKey] = useState(0);
  const [latencyMs, setLatencyMs] = useState(38);
  const verifyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = () => {
    setPin("");
    setBypassState("input");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleKey = (k: string) => {
    if (bypassState === "verifying" || bypassState === "success") return;
    if (k === "DEL") {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (pin.length >= 6) return;
    const next = pin + k;
    setPin(next);

    if (next.length === 6) {
      setBypassState("verifying");
      const startTime = Date.now();
      const timestamp = new Date().toLocaleTimeString("id-ID");
      addLog({ type: "auth", status: "Info", message: "Mencoba Emergency Bypass PIN" });

      verifyTimer.current = setTimeout(async () => {
        try {
          const savedPin = await databaseService.getBypassPin();
          const isValid = next === savedPin;
          setLatencyMs(Math.max(28, Date.now() - startTime));

          if (isValid) {
            await sendCommand(`PIN_${next}`);
            setBypassState("success");

            if (purpose === "re_register") {
              addLog({ type: "reg", status: "Success", message: "PIN Valid — Izin Registrasi Ulang Diberikan" });
              onVerified?.();
            } else {
              await sendCommand("UNLOCK_MANUAL");
              addLog({ type: "auth", status: "Success", message: "Bypass Disetujui — Pintu Terbuka (UNLOCKED)" });

              // Catat ke SQLite log_autentikasi
              await databaseService.addAuthLog({
                timestamp,
                userId: "Admin (Bypass PIN)",
                score: "100%",
                status: "BYPASS",
                incremental: "Manual Key",
                message: "Emergency Bypass Berhasil - Pintu Terbuka",
              });

              onUnlock?.();
            }

            // Otomatis tutup modal dan kembali ke menu utama setelah 1 detik
            setTimeout(() => {
              handleClose();
            }, 1000);
          } else {
            setBypassState("failed");
            setShakeKey((s) => s + 1);

            if (purpose === "re_register") {
              addLog({ type: "reg", status: "Failed", message: "PIN Salah — Registrasi Ulang Ditolak" });
            } else {
              addLog({ type: "auth", status: "Failed", message: "Bypass Ditolak - PIN Salah" });

              // Catat percobaan gagal ke SQLite log_autentikasi
              await databaseService.addAuthLog({
                timestamp,
                userId: "Unknown (Bypass)",
                score: "0%",
                status: "FAILED",
                incremental: "Rejected",
                message: `Percobaan Bypass Gagal - PIN Salah`,
              });
            }
          }
        } catch (error) {
          console.error("Error saat verifikasi bypass:", error);
          setBypassState("failed");
          setShakeKey((s) => s + 1);
          addLog({ type: "system", status: "Failed", message: "Gagal memverifikasi PIN bypass" });
        }
      }, 700);
    }
  };

  useEffect(() => {
    if (!open) reset();
    return () => { if (verifyTimer.current) clearTimeout(verifyTimer.current); };
  }, [open]);

  const slotColor = (i: number) => {
    if (bypassState === "success") return { bg: "#F0FFF7", border: "#22C55E", dot: "#16A34A" };
    if (bypassState === "failed") return { bg: "#FEF2F2", border: "#EF4444", dot: "#DC2626" };
    if (i < pin.length) return { bg: "#F0FFFB", border: TEAL, dot: "#0D9488" };
    return { bg: "#F8FAFC", border: "#E2E8F0", dot: "transparent" };
  };

  const headerColor = bypassState === "success" ? "#16A34A" : bypassState === "failed" ? "#DC2626" : "#0D9488";

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-50"
            style={{ background: "rgba(15,23,42,0.55)", backdropFilter: "blur(3px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
          />

          {/* Bottom Sheet */}
          <motion.div
            className="fixed bottom-0 left-0 right-0 md:bottom-8 md:left-1/2 md:-translate-x-1/2 md:max-w-md md:w-full z-50 rounded-t-3xl md:rounded-3xl overflow-hidden"
            style={{
              background: "#FFFFFF",
              boxShadow: "0 -12px 48px rgba(15,23,42,0.18), 0 -1px 0 #E2E8F0",
              maxHeight: "92dvh",
              overflowY: "auto",
            }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 320 }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3">
              <div className="w-10 h-1 rounded-full" style={{ background: "#E2E8F0" }} />
            </div>

            {/* Header */}
            <div className="px-5 pt-4 pb-4" style={{ borderBottom: "1px solid #F1F5F9" }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: bypassState === "success" ? "#F0FFF7" : bypassState === "failed" ? "#FEF2F2" : TEAL_BG, border: `1.5px solid ${bypassState === "success" ? "#BBF7D0" : bypassState === "failed" ? "#FECACA" : TEAL_BORDER}` }}
                  >
                    <Zap size={17} style={{ color: headerColor }} />
                  </div>
                  <div>
                    <h2 style={{ color: "#1E293B", fontFamily: SANS, fontWeight: 700, fontSize: "0.88rem" }}>
                      {purpose === "re_register" ? "Verifikasi Registrasi Ulang" : "Buka Pintu Manual (Bypass)"}
                    </h2>
                    <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.58rem", marginTop: 1, letterSpacing: "0.04em" }}>
                      {bypassState === "input" || bypassState === "verifying"
                        ? (purpose === "re_register" ? "Masukkan PIN Bypass untuk izin registrasi ulang" : "Masukkan PIN 6-Digit untuk membuka pintu")
                        : bypassState === "success"
                          ? (purpose === "re_register" ? "PIN Benar · Memulai pendaftaran baru..." : "Otorisasi berhasil · Pintu terbuka")
                          : "Otorisasi gagal · PIN salah"}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleClose}
                  className="w-7 h-7 rounded-full flex items-center justify-center transition-colors shrink-0"
                  style={{ background: "#F1F5F9", color: "#64748B" }}
                >
                  <X size={13} />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="px-5 pt-5 pb-6">
              <AnimatePresence mode="wait">

                {/* ── SUCCESS ── */}
                {bypassState === "success" && (
                  <motion.div
                    key="success"
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col items-center text-center gap-4"
                  >
                    {/* PIN slots — green */}
                    <div className="flex gap-2">
                      {Array.from({ length: 6 }).map((_, i) => {
                        const c = slotColor(i);
                        return (
                          <motion.div
                            key={i}
                            initial={{ scale: 0.8 }}
                            animate={{ scale: 1 }}
                            transition={{ delay: i * 0.05, type: "spring", damping: 12 }}
                            className="w-10 h-12 rounded-xl flex items-center justify-center"
                            style={{ background: c.bg, border: `2px solid ${c.border}` }}
                          >
                            <div className="w-3 h-3 rounded-full" style={{ background: c.dot }} />
                          </motion.div>
                        );
                      })}
                    </div>

                    {/* Big checkmark */}
                    <motion.div
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: "spring", damping: 14, delay: 0.1 }}
                      className="w-20 h-20 rounded-full flex items-center justify-center"
                      style={{ background: "#F0FFF7", border: "2.5px solid #22C55E", boxShadow: "0 0 32px rgba(34,197,94,0.2)" }}
                    >
                      <CheckCircle2 size={40} style={{ color: "#16A34A" }} />
                    </motion.div>

                    <div>
                      <p style={{ color: "#15803D", fontFamily: MONO, fontWeight: 700, fontSize: "0.85rem", letterSpacing: "0.06em" }}>
                        {purpose === "re_register" ? "PIN Valid — Izin Diberikan" : "Bypass Berhasil — Pintu Terbuka"}
                      </p>
                      <p style={{ color: "#64748B", fontFamily: SANS, fontSize: "0.75rem", marginTop: 3 }}>
                        {purpose === "re_register" ? "Memulai sesi pendaftaran langkah kaki baru..." : "Akses smart door terbuka (UNLOCKED)"}
                      </p>
                    </div>

                    {/* Technical badge */}
                    <div className="flex items-center gap-3">
                      <div
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                        style={{ background: TEAL_BG, border: `1px solid ${TEAL_BORDER}` }}
                      >
                        <Clock size={11} style={{ color: "#0D9488" }} />
                        <span style={{ color: "#0D9488", fontFamily: MONO, fontSize: "0.62rem", fontWeight: 700 }}>
                          Latensi: {latencyMs}ms
                        </span>
                      </div>
                      <div
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                        style={{ background: "#F0FFF7", border: "1px solid #BBF7D0" }}
                      >
                        <span style={{ color: "#16A34A", fontFamily: MONO, fontSize: "0.62rem", fontWeight: 700 }}>
                          {purpose === "re_register" ? "IZIN REGISTRASI: AKTIF" : "STATUS: UNLOCKED"}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={handleClose}
                      className="w-full py-3.5 rounded-xl transition-all active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                      style={{
                        background: "#16A34A",
                        border: "1px solid #15803D",
                        color: "#FFFFFF",
                        fontFamily: MONO,
                        fontSize: "0.72rem",
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                      }}
                    >
                      {purpose === "re_register" ? "LANJUT KE REGISTRASI" : "KEMBALI KE MENU UTAMA"}
                    </button>
                  </motion.div>
                )}

                {/* ── FAILED ── */}
                {bypassState === "failed" && (
                  <motion.div
                    key="failed"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col items-center text-center gap-4"
                  >
                    {/* PIN slots — red with shake */}
                    <motion.div
                      key={shakeKey}
                      className="flex gap-2"
                      animate={{ x: [0, -8, 8, -6, 6, -4, 4, 0] }}
                      transition={{ duration: 0.45, ease: "easeInOut" }}
                    >
                      {Array.from({ length: 6 }).map((_, i) => {
                        const c = slotColor(i);
                        return (
                          <div
                            key={i}
                            className="w-10 h-12 rounded-xl flex items-center justify-center"
                            style={{ background: c.bg, border: `2px solid ${c.border}` }}
                          >
                            <div className="w-3 h-3 rounded-full" style={{ background: c.dot }} />
                          </div>
                        );
                      })}
                    </motion.div>

                    {/* X icon */}
                    <motion.div
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: "spring", damping: 14 }}
                      className="w-20 h-20 rounded-full flex items-center justify-center"
                      style={{ background: "#FEF2F2", border: "2.5px solid #EF4444", boxShadow: "0 0 24px rgba(239,68,68,0.15)" }}
                    >
                      <XCircle size={40} style={{ color: "#DC2626" }} />
                    </motion.div>

                    <div>
                      <p style={{ color: "#B91C1C", fontFamily: MONO, fontWeight: 700, fontSize: "0.82rem", letterSpacing: "0.06em" }}>
                        {purpose === "re_register" ? "PIN Salah — Registrasi Ulang Ditolak" : "PIN Salah — Akses Ditolak"}
                      </p>
                      <p style={{ color: "#64748B", fontFamily: SANS, fontSize: "0.72rem", marginTop: 3 }}>
                        Percobaan gagal dicatat dalam log audit
                      </p>
                    </div>

                    <div
                      className="w-full flex items-center gap-2 p-3 rounded-xl"
                      style={{ background: "#FEF2F2", border: "1px solid #FECACA" }}
                    >
                      <span style={{ color: "#DC2626", fontFamily: MONO, fontSize: "0.6rem", fontWeight: 600 }}>
                        AUDIT LOG: BYPASS_FAILED · {new Date().toLocaleTimeString("id-ID")} · Unit A7
                      </span>
                    </div>

                    <button
                      onClick={reset}
                      className="w-full py-3 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                      style={{ background: TEAL_BG, border: `1.5px solid ${TEAL_BORDER}`, color: "#0D9488", fontFamily: MONO, fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.08em" }}
                    >
                      <RotateCcw size={14} />
                      COBA LAGI
                    </button>
                  </motion.div>
                )}

                {/* ── INPUT / VERIFYING ── */}
                {(bypassState === "input" || bypassState === "verifying") && (
                  <motion.div
                    key="input"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col gap-5"
                  >
                    {/* PIN slots */}
                    <div className="flex gap-2 justify-center">
                      {Array.from({ length: 6 }).map((_, i) => {
                        const filled = i < pin.length;
                        const isActive = i === pin.length && bypassState === "input";
                        return (
                          <motion.div
                            key={i}
                            className="w-11 h-13 rounded-xl flex items-center justify-center"
                            style={{
                              width: 44,
                              height: 52,
                              background: filled ? TEAL_BG : "#F8FAFC",
                              border: `2px solid ${isActive ? TEAL : filled ? TEAL_BORDER : "#E2E8F0"}`,
                              boxShadow: isActive ? `0 0 0 3px ${TEAL}22` : "none",
                              transition: "all 0.15s",
                            }}
                            animate={filled ? { scale: [1, 1.1, 1] } : {}}
                            transition={{ duration: 0.15 }}
                          >
                            {filled ? (
                              <div className="w-3 h-3 rounded-full" style={{ background: "#0D9488" }} />
                            ) : (
                              <div className="w-2 h-2 rounded-full" style={{ background: "#E2E8F0" }} />
                            )}
                          </motion.div>
                        );
                      })}
                    </div>

                    {bypassState === "verifying" && (
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: `${TEAL} transparent ${TEAL} ${TEAL}` }} />
                        <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.65rem" }}>Memverifikasi PIN...</p>
                      </div>
                    )}

                    {/* Numpad */}
                    {bypassState === "input" && (
                      <div className="grid gap-2" style={{ gridTemplateRows: "repeat(4, 1fr)" }}>
                        {PAD_KEYS.map((row, ri) => (
                          <div key={ri} className="grid grid-cols-3 gap-2">
                            {row.map((key, ki) => {
                              if (key === "") return <div key={ki} />;
                              const isDel = key === "DEL";
                              return (
                                <motion.button
                                  key={ki}
                                  onClick={() => handleKey(key)}
                                  whileTap={{ scale: 0.93 }}
                                  className="rounded-2xl flex items-center justify-center transition-colors"
                                  style={{
                                    height: 54,
                                    background: isDel ? "#FEF2F2" : "#F8FAFC",
                                    border: `1.5px solid ${isDel ? "#FECACA" : "#E2E8F0"}`,
                                    boxShadow: "0 1px 3px rgba(15,23,42,0.06)",
                                  }}
                                  onMouseEnter={(e) => {
                                    (e.currentTarget as HTMLButtonElement).style.background = isDel ? "#FEE2E2" : TEAL_BG;
                                    (e.currentTarget as HTMLButtonElement).style.borderColor = isDel ? "#EF4444" : TEAL;
                                  }}
                                  onMouseLeave={(e) => {
                                    (e.currentTarget as HTMLButtonElement).style.background = isDel ? "#FEF2F2" : "#F8FAFC";
                                    (e.currentTarget as HTMLButtonElement).style.borderColor = isDel ? "#FECACA" : "#E2E8F0";
                                  }}
                                >
                                  {isDel ? (
                                    <Delete size={18} style={{ color: "#DC2626" }} />
                                  ) : (
                                    <span style={{
                                      color: "#1E293B",
                                      fontFamily: MONO,
                                      fontSize: "1.25rem",
                                      fontWeight: 700,
                                    }}>
                                      {key}
                                    </span>
                                  )}
                                </motion.button>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    )}

                    <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.58rem", textAlign: "center", letterSpacing: "0.04em" }}>
                      Bypass darurat dicatat dalam log audit · Unit #A7
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
