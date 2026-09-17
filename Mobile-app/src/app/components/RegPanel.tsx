import { motion } from "motion/react";
import { Loader2, CheckCircle2 } from "lucide-react";

interface RegPanelProps {
  isScanning: boolean;
  progress: number;
  total: number;
}

const MONO = "JetBrains Mono, monospace";
const SANS = "Inter, sans-serif";

export function RegPanel({ isScanning, progress, total }: RegPanelProps) {
  const pct = Math.round((progress / total) * 100);
  const allDone = progress >= total;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: "#FFFFFF",
        border: "1px solid #E2E8F0",
        boxShadow: "0 2px 12px rgba(30,41,59,0.06)",
      }}
    >
      {/* Top label */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "1px solid #F1F5F9" }}
      >
        <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.12em", textTransform: "uppercase" }}>
          PROGRES PENDAFTARAN · Unit A7
        </p>
        <div className="flex items-center gap-1.5">
          <div
            className="h-2 w-2 rounded-full"
            style={{
              background: isScanning ? "#2563EB" : "#CBD5E1",
              boxShadow: isScanning ? "0 0 6px #2563EB80" : "none",
            }}
          />
          <p style={{ color: isScanning ? "#2563EB" : "#94A3B8", fontFamily: MONO, fontSize: "0.58rem", fontWeight: 600 }}>
            {isScanning ? "MEREKAM" : "SIAGA"}
          </p>
        </div>
      </div>

      {/* Giant counter area */}
      <div
        className="flex flex-col items-center justify-center py-10 px-6"
        style={{ background: "#FAFBFF", minHeight: 220 }}
      >
        {isScanning ? (
          <>
            {/* Spinning or Check icon */}
            <div className="mb-4">
              {allDone ? (
                <CheckCircle2 size={32} style={{ color: "#16A34A" }} />
              ) : (
                <Loader2 size={28} className="animate-spin" style={{ color: "#2563EB" }} />
              )}
            </div>

            {/* Giant counter */}
            <motion.div
              className="text-center"
              key={progress}
              initial={{ scale: 0.85, opacity: 0.5 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", damping: 14, stiffness: 260 }}
            >
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 4 }}>
                <span style={{
                  color: allDone ? "#16A34A" : "#2563EB",
                  fontFamily: MONO,
                  fontSize: "4.5rem",
                  fontWeight: 800,
                  lineHeight: 1,
                  letterSpacing: "-0.04em",
                }}>
                  {progress}
                </span>
                <span style={{
                  color: "#CBD5E1",
                  fontFamily: MONO,
                  fontSize: "2.2rem",
                  fontWeight: 700,
                  lineHeight: 1,
                }}>
                  / {total}
                </span>
              </div>
            </motion.div>

            <p className="mt-3" style={{ color: allDone ? "#16A34A" : "#64748B", fontFamily: SANS, fontSize: "0.82rem", fontWeight: 600 }}>
              {allDone ? "10/10 Jendela Terpenuhi!" : "Jendela Valid"}
            </p>

            {/* Circular-ish progress dots */}
            <div className="flex gap-1.5 mt-5 flex-wrap justify-center" style={{ maxWidth: 240 }}>
              {Array.from({ length: total }).map((_, i) => (
                <motion.div
                  key={i}
                  className="w-5 h-5 rounded-md flex items-center justify-center"
                  style={{
                    background: i < progress ? (allDone ? "#DCFCE7" : "#EFF6FF") : "#F1F5F9",
                    border: `1.5px solid ${i < progress ? (allDone ? "#16A34A" : "#2563EB") : "#E2E8F0"}`,
                  }}
                  animate={{ scale: i === progress - 1 ? [1, 1.2, 1] : 1 }}
                  transition={{ duration: 0.3 }}
                >
                  {i < progress && (
                    <div className="w-2 h-2 rounded-sm" style={{ background: allDone ? "#16A34A" : "#2563EB" }} />
                  )}
                </motion.div>
              ))}
            </div>

            <p className="mt-4" style={{ color: allDone ? "#16A34A" : "#94A3B8", fontFamily: MONO, fontSize: "0.62rem", fontWeight: allDone ? 700 : 500 }}>
              {allDone ? "100% Selesai · Menyimpan Profil ke SQLite..." : `${pct}% selesai · Terus berjalan secara alami`}
            </p>
          </>
        ) : (
          <div className="text-center">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ background: "#EFF6FF", border: "1px solid #BFDBFE" }}
            >
              <CheckCircle2 size={32} style={{ color: "#2563EB" }} />
            </div>
            <p style={{ color: "#94A3B8", fontFamily: SANS, fontSize: "0.85rem" }}>
              Siap untuk merekam
            </p>
            <p className="mt-1" style={{ color: "#CBD5E1", fontFamily: MONO, fontSize: "0.62rem" }}>
              Tekan MULAI REGISTRASI untuk memulai
            </p>
          </div>
        )}
      </div>

      {/* Bottom info strip */}
      <div
        className="px-4 py-3 flex items-center justify-between"
        style={{ borderTop: "1px solid #F1F5F9", background: "#FFFFFF" }}
      >
        <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Target Jendela
        </p>
        <p style={{ color: "#1E293B", fontFamily: MONO, fontSize: "0.68rem", fontWeight: 700 }}>
          {total} Jendela Diperlukan
        </p>
      </div>
    </div>
  );
}
