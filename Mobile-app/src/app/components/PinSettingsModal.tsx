import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Delete, CheckCircle2, ShieldCheck, KeyRound, Eye, EyeOff, AlertCircle } from "lucide-react";
import { databaseService } from "../services/databaseService";

interface PinSettingsModalProps {
  open: boolean;
  onClose: () => void;
  currentPin?: string;
  onSuccess?: (newPin: string) => void;
}

type Step = 1 | 2 | 3 | "done";

const MONO = "JetBrains Mono, monospace";
const SANS = "Inter, sans-serif";
const TEAL = "#0D9488";
const TEAL_BG = "#F0FFFB";
const TEAL_BORDER = "#A7F3D0";

const PAD_KEYS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["", "0", "DEL"],
];

export function PinSettingsModal({ open, onClose, currentPin, onSuccess }: PinSettingsModalProps) {
  const [step, setStep] = useState<Step>(1);
  const [activePin, setActivePin] = useState(currentPin || "123456");
  const [inputVal, setInputVal] = useState("");
  const [newPinCandidate, setNewPinCandidate] = useState("");
  const [shakeKey, setShakeKey] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showPin, setShowPin] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Muat PIN aktual dari SQLite saat modal dibuka
  useEffect(() => {
    if (open) {
      setStep(1);
      setInputVal("");
      setNewPinCandidate("");
      setErrorMsg(null);
      setShowPin(false);
      setIsSaving(false);
      databaseService.getBypassPin().then((pin) => {
        if (pin) setActivePin(pin);
      });
    }
  }, [open]);

  const handleKey = async (k: string) => {
    if (step === "done" || isSaving) return;

    if (k === "DEL") {
      setInputVal((prev) => prev.slice(0, -1));
      setErrorMsg(null);
      return;
    }

    if (inputVal.length >= 6) return;

    const next = inputVal + k;
    setInputVal(next);
    setErrorMsg(null);

    // Otomatis verifikasi begitu 6 digit lengkap
    if (next.length === 6) {
      if (step === 1) {
        // Step 1: Konfirmasi PIN Lama
        if (next === activePin) {
          setInputVal("");
          setStep(2);
        } else {
          setShakeKey((s) => s + 1);
          setErrorMsg("PIN lama tidak sesuai!");
          setTimeout(() => {
            setInputVal("");
          }, 400);
        }
      } else if (step === 2) {
        // Step 2: Masukkan PIN Baru
        setNewPinCandidate(next);
        setInputVal("");
        setStep(3);
      } else if (step === 3) {
        // Step 3: Konfirmasi PIN Baru
        if (next === newPinCandidate) {
          setIsSaving(true);
          try {
            await databaseService.saveBypassPin(next);
            setActivePin(next);
            setStep("done");
            onSuccess?.(next);
          } catch (err) {
            console.error("Gagal simpan PIN:", err);
            setErrorMsg("Gagal menyimpan ke database");
          } finally {
            setIsSaving(false);
          }
        } else {
          setShakeKey((s) => s + 1);
          setErrorMsg("Konfirmasi PIN tidak cocok!");
          setTimeout(() => {
            setInputVal("");
          }, 400);
        }
      }
    }
  };

  const stepTitle = {
    1: "Konfirmasi PIN Lama",
    2: "Masukkan PIN Baru",
    3: "Konfirmasi PIN Baru",
    done: "PIN Berhasil Diperbarui",
  }[step];

  const stepDesc = {
    1: "Masukkan 6 digit PIN saat ini (default: 123456)",
    2: "Ketik 6 digit angka PIN baru yang Anda inginkan",
    3: "Ketik ulang PIN baru untuk memastikan kecocokan",
    done: "PIN Emergency Bypass baru aktif dan tersimpan ke SQLite",
  }[step];

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-50 select-none"
            style={{ background: "rgba(15,23,42,0.6)", backdropFilter: "blur(4px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Modal Bottom Sheet */}
          <motion.div
            className="fixed bottom-0 left-0 right-0 md:bottom-8 md:left-1/2 md:-translate-x-1/2 md:max-w-md md:w-full z-50 rounded-t-3xl md:rounded-3xl overflow-hidden select-none"
            style={{
              background: "#FFFFFF",
              boxShadow: "0 -12px 48px rgba(15,23,42,0.2)",
              maxHeight: "92dvh",
              overflowY: "auto",
            }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
          >
            {/* Grab handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full" style={{ background: "#CBD5E1" }} />
            </div>

            {/* Header */}
            <div className="px-6 pt-3 pb-3 flex items-center justify-between border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: TEAL_BG, border: `1px solid ${TEAL_BORDER}` }}
                >
                  <KeyRound size={18} style={{ color: TEAL }} />
                </div>
                <div>
                  <p style={{ color: "#1E293B", fontFamily: SANS, fontWeight: 700, fontSize: "0.92rem" }}>
                    Pengaturan PIN Bypass
                  </p>
                  <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.6rem" }}>
                    SINKRON DENGAN SQLITE
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 active:scale-95 cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>

            {/* Step Progress Indicator (1/3, 2/3, 3/3) */}
            {step !== "done" && (
              <div className="px-6 pt-3.5 pb-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {[1, 2, 3].map((s) => (
                    <div
                      key={s}
                      className="h-1.5 rounded-full transition-all duration-300"
                      style={{
                        width: step === s ? 32 : 16,
                        background: step >= s ? TEAL : "#CBD5E1",
                      }}
                    />
                  ))}
                </div>
                <span style={{ color: TEAL, fontFamily: MONO, fontSize: "0.65rem", fontWeight: 700 }}>
                  LANGKAH {step} DARI 3
                </span>
              </div>
            )}

            {/* Main Content Area */}
            <div className="px-6 py-4 flex flex-col items-center">
              <p style={{ color: "#1E293B", fontFamily: SANS, fontWeight: 700, fontSize: "0.95rem" }}>
                {stepTitle}
              </p>
              <p style={{ color: "#64748B", fontFamily: SANS, fontSize: "0.72rem", textAlign: "center", marginTop: 2 }}>
                {stepDesc}
              </p>

              {/* Tampilan Selesai */}
              {step === "done" ? (
                <div className="w-full my-6 flex flex-col items-center text-center">
                  <div className="w-16 h-16 rounded-3xl bg-emerald-50 border-2 border-emerald-200 flex items-center justify-center mb-3">
                    <CheckCircle2 size={36} className="text-emerald-600" />
                  </div>
                  <p style={{ color: "#15803D", fontFamily: MONO, fontSize: "0.82rem", fontWeight: 700 }}>
                    PIN BERHASIL DISIMPAN!
                  </p>
                  <p style={{ color: "#64748B", fontFamily: SANS, fontSize: "0.75rem", marginTop: 2 }}>
                    Gunakan PIN ini saat melakukan Emergency Bypass.
                  </p>

                  {/* PIN Display Card with Show/Hide toggle */}
                  <div
                    className="mt-4 px-4 py-3 rounded-2xl flex items-center gap-3 border"
                    style={{ background: "#F8FAFC", borderColor: "#E2E8F0" }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.68rem" }}>PIN BARU:</span>
                      <span style={{ color: "#1E293B", fontFamily: MONO, fontSize: "1.1rem", fontWeight: 800, letterSpacing: "0.2em" }}>
                        {showPin ? activePin : "••••••"}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowPin(!showPin)}
                      className="p-1 rounded-lg hover:bg-slate-200 text-slate-500 cursor-pointer"
                      title={showPin ? "Sembunyikan" : "Tampilkan"}
                    >
                      {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>

                  <button
                    onClick={onClose}
                    className="mt-6 w-full py-3 rounded-2xl text-white font-bold transition-all active:scale-[0.98] cursor-pointer"
                    style={{ background: "linear-gradient(135deg,#16A34A,#15803D)", fontFamily: MONO, fontSize: "0.75rem" }}
                  >
                    SELESAI
                  </button>
                </div>
              ) : (
                <>
                  {/* PIN Display Slots (6 Bullets) with Shake Animation */}
                  <motion.div
                    key={shakeKey}
                    animate={shakeKey > 0 ? { x: [-10, 10, -8, 8, -4, 4, 0] } : {}}
                    transition={{ duration: 0.35 }}
                    className="flex justify-center gap-3 my-5"
                  >
                    {Array.from({ length: 6 }).map((_, i) => {
                      const isFilled = i < inputVal.length;
                      return (
                        <div
                          key={i}
                          className="w-10 h-12 rounded-xl flex items-center justify-center border-2 transition-all duration-150"
                          style={{
                            background: isFilled ? TEAL_BG : "#F8FAFC",
                            borderColor: errorMsg ? "#EF4444" : isFilled ? TEAL : "#CBD5E1",
                          }}
                        >
                          {isFilled && (
                            <div className="w-3.5 h-3.5 rounded-full" style={{ background: errorMsg ? "#EF4444" : TEAL }} />
                          )}
                        </div>
                      );
                    })}
                  </motion.div>

                  {/* Error Notification */}
                  <div className="h-6 flex items-center justify-center">
                    {errorMsg && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-center gap-1.5 text-red-600"
                      >
                        <AlertCircle size={14} />
                        <span style={{ fontFamily: MONO, fontSize: "0.68rem", fontWeight: 600 }}>{errorMsg}</span>
                      </motion.div>
                    )}
                  </div>

                  {/* Custom Number Pad */}
                  <div className="w-full max-w-xs grid grid-cols-3 gap-2.5 mt-2">
                    {PAD_KEYS.flat().map((k, idx) => {
                      if (!k) return <div key={idx} />;
                      const isDel = k === "DEL";
                      return (
                        <button
                          key={k}
                          type="button"
                          onClick={() => handleKey(k)}
                          className="h-12 rounded-xl flex items-center justify-center font-bold text-slate-800 transition-all active:scale-95 cursor-pointer shadow-xs"
                          style={{
                            background: isDel ? "#FEF2F2" : "#F8FAFC",
                            border: `1px solid ${isDel ? "#FECACA" : "#E2E8F0"}`,
                            color: isDel ? "#DC2626" : "#1E293B",
                            fontFamily: MONO,
                            fontSize: isDel ? "0.75rem" : "1.1rem",
                          }}
                        >
                          {isDel ? <Delete size={18} /> : k}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
