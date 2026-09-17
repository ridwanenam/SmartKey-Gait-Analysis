import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Delete, CheckCircle2, ShieldCheck, KeyRound } from "lucide-react";
import { databaseService } from "../services/databaseService";

interface SetPinModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (pin: string) => void;
}

const MONO = "JetBrains Mono, monospace";
const SANS = "Inter, sans-serif";

const PAD_KEYS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["", "0", "DEL"],
];

export function SetPinModal({ open, onClose, onSuccess }: SetPinModalProps) {
  const [pin, setPin] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDone, setIsDone] = useState(false);

  useEffect(() => {
    if (open) {
      setPin("");
      setIsSaving(false);
      setIsDone(false);
    }
  }, [open]);

  const handleKey = async (k: string) => {
    if (isSaving || isDone) return;
    if (k === "DEL") {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (pin.length >= 6) return;

    const next = pin + k;
    setPin(next);

    if (next.length === 6) {
      setIsSaving(true);
      try {
        await databaseService.saveBypassPin(next);
        setIsDone(true);
        setTimeout(() => {
          onSuccess?.(next);
          onClose();
        }, 1200);
      } catch (err) {
        console.error("Gagal menyimpan PIN ke SQLite:", err);
        setIsSaving(false);
      }
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 z-50"
            style={{ background: "rgba(15,23,42,0.6)", backdropFilter: "blur(4px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Modal Bottom Sheet */}
          <motion.div
            className="absolute bottom-0 left-0 right-0 z-50 rounded-t-3xl overflow-hidden"
            style={{
              background: "#FFFFFF",
              boxShadow: "0 -12px 48px rgba(15,23,42,0.2)",
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
            <div className="px-6 pt-3 pb-4 flex items-center justify-between border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center">
                  <KeyRound size={18} className="text-blue-600" />
                </div>
                <div>
                  <p style={{ color: "#1E293B", fontFamily: SANS, fontWeight: 700, fontSize: "0.95rem" }}>
                    Buat PIN Bypass Darurat
                  </p>
                  <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.62rem" }}>
                    Disimpan Permanen ke SQLite
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 active:scale-95"
              >
                <X size={15} />
              </button>
            </div>

            {/* Content / Pin slot display */}
            <div className="px-6 py-6 flex flex-col items-center">
              {isDone ? (
                <motion.div
                  className="flex flex-col items-center py-4"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                >
                  <div className="w-14 h-14 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mb-3">
                    <CheckCircle2 size={32} className="text-emerald-600" />
                  </div>
                  <p style={{ color: "#15803D", fontFamily: SANS, fontWeight: 700, fontSize: "0.9rem" }}>
                    PIN Berhasil Disimpan!
                  </p>
                  <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.65rem", marginTop: 4 }}>
                    Tersimpan di tabel user_security SQLite
                  </p>
                </motion.div>
              ) : (
                <>
                  <p style={{ color: "#64748B", fontFamily: SANS, fontSize: "0.78rem", textAlign: "center", maxWidth: 280 }}>
                    Registrasi langkah kaki selesai! Masukkan 6 angka untuk PIN darurat Anda:
                  </p>

                  {/* 6 Digit Indicators */}
                  <div className="flex gap-2.5 my-6">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div
                        key={i}
                        className="w-11 h-13 rounded-xl flex items-center justify-center border-2 transition-all"
                        style={{
                          background: i < pin.length ? "#EFF6FF" : "#F8FAFC",
                          borderColor: i === pin.length ? "#2563EB" : i < pin.length ? "#93C5FD" : "#E2E8F0",
                          boxShadow: i === pin.length ? "0 0 0 3px rgba(37,99,235,0.15)" : "none",
                        }}
                      >
                        {i < pin.length ? (
                          <span style={{ color: "#1E293B", fontFamily: MONO, fontSize: "1.3rem", fontWeight: 700 }}>
                            {pin[i]}
                          </span>
                        ) : (
                          <div className="w-2 h-2 rounded-full bg-slate-300" />
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Keypad */}
                  <div className="grid grid-cols-3 gap-2 w-full max-w-[280px]">
                    {PAD_KEYS.flat().map((k, idx) => {
                      if (k === "") return <div key={idx} />;
                      const isDel = k === "DEL";
                      return (
                        <button
                          key={idx}
                          onClick={() => handleKey(k)}
                          disabled={isSaving}
                          className="h-13 rounded-2xl flex items-center justify-center transition-all active:scale-95 cursor-pointer font-bold select-none"
                          style={{
                            background: isDel ? "#FEF2F2" : "#F8FAFC",
                            border: `1.5px solid ${isDel ? "#FECACA" : "#E2E8F0"}`,
                            color: isDel ? "#DC2626" : "#1E293B",
                            fontFamily: MONO,
                            fontSize: isDel ? "0.7rem" : "1.15rem",
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

            {/* Bottom Safe Area */}
            <div className="h-5" />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
