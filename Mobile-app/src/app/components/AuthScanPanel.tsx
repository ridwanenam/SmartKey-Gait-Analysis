import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Loader2 } from "lucide-react";

interface AuthScanPanelProps {
  isScanning: boolean;
  progress: number;
  total: number;
  diagScore: string;
  diagVector: string;
  diagCov: string;
  diagDelta: string;
}

const MONO = "JetBrains Mono, monospace";
const SANS = "Inter, sans-serif";

export function AuthScanPanel({ isScanning, progress, total, diagScore, diagVector, diagCov, diagDelta }: AuthScanPanelProps) {
  const lineRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex flex-col gap-3">
      {/* Main scanning display */}
      <div
        className="rounded-2xl overflow-hidden relative"
        style={{
          background: "#FFFFFF",
          border: "1px solid #E2E8F0",
          boxShadow: "0 2px 12px rgba(30,41,59,0.06)",
        }}
      >
        {/* Top label row */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid #F1F5F9" }}
        >
          <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.12em", textTransform: "uppercase" }}>
            STATUS PEMINDAIAN · Unit A7
          </p>
          <div className="flex items-center gap-1.5">
            <div
              className="h-2 w-2 rounded-full"
              style={{
                background: isScanning ? "#16A34A" : "#CBD5E1",
                boxShadow: isScanning ? "0 0 6px #16A34A80" : "none",
              }}
            />
            <p style={{ color: isScanning ? "#16A34A" : "#94A3B8", fontFamily: MONO, fontSize: "0.58rem", fontWeight: 600 }}>
              {isScanning ? "AKTIF" : "SIAGA"}
            </p>
          </div>
        </div>

        {/* Scanning area */}
        <div
          className="relative overflow-hidden flex flex-col items-center justify-center"
          style={{ height: 180, background: isScanning ? "#F8FAFC" : "#FAFAFA" }}
        >
          {/* Horizontal scan lines background */}
          {Array.from({ length: 9 }).map((_, i) => (
            <div
              key={i}
              className="absolute left-0 right-0"
              style={{
                top: `${(i + 1) * 10}%`,
                height: 1,
                background: isScanning ? "rgba(37,99,235,0.06)" : "rgba(203,213,225,0.5)",
              }}
            />
          ))}

          {/* Animated scanning line */}
          {isScanning && (
            <motion.div
              className="absolute left-0 right-0"
              style={{ height: 2, background: "linear-gradient(90deg, transparent, #2563EB, #16A34A, transparent)", zIndex: 2 }}
              animate={{ top: ["10%", "90%", "10%"] }}
              transition={{ duration: 2.4, ease: "easeInOut", repeat: Infinity }}
            />
          )}

          {/* Glow overlay while scanning */}
          {isScanning && (
            <motion.div
              className="absolute left-0 right-0"
              style={{ height: 40, background: "linear-gradient(180deg, transparent, rgba(37,99,235,0.06), transparent)", zIndex: 1, pointerEvents: "none" }}
              animate={{ top: ["5%", "85%", "5%"] }}
              transition={{ duration: 2.4, ease: "easeInOut", repeat: Infinity }}
            />
          )}

          {/* Center content */}
          <div className="relative z-10 text-center px-6">
            {isScanning ? (
              <>
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Loader2 size={16} className="animate-spin" style={{ color: "#2563EB" }} />
                  <p style={{ color: "#2563EB", fontFamily: MONO, fontWeight: 700, fontSize: "0.72rem", letterSpacing: "0.06em" }}>
                    MEMINDAI...
                  </p>
                </div>
                <p style={{ color: "#1E293B", fontFamily: SANS, fontSize: "0.82rem", fontWeight: 600, lineHeight: 1.4 }}>
                  Sedang Menganalisis<br />Gaya Berjalan...
                </p>
                <p className="mt-2" style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.65rem" }}>
                  Jendela Divalidasi:{" "}
                  <span style={{ color: "#2563EB", fontWeight: 700 }}>{progress}/{total}</span>
                </p>
              </>
            ) : (
              <p style={{ color: "#94A3B8", fontFamily: SANS, fontSize: "0.82rem" }}>
                Sistem siap · Tekan tombol untuk memulai
              </p>
            )}
          </div>

          {/* Corner brackets */}
          {["top-2 left-2", "top-2 right-2", "bottom-2 left-2", "bottom-2 right-2"].map((pos, i) => (
            <div
              key={i}
              className={`absolute ${pos} w-4 h-4`}
              style={{
                borderColor: isScanning ? "rgba(37,99,235,0.35)" : "#E2E8F0",
                borderStyle: "solid",
                borderWidth: i === 0 ? "2px 0 0 2px" : i === 1 ? "2px 2px 0 0" : i === 2 ? "0 0 2px 2px" : "0 2px 2px 0",
                borderRadius: i === 0 ? "6px 0 0 0" : i === 1 ? "0 6px 0 0" : i === 2 ? "0 0 0 6px" : "0 0 6px 0",
              }}
            />
          ))}
        </div>

        {/* Progress bar */}
        {isScanning && (
          <div className="px-4 py-3" style={{ borderTop: "1px solid #F1F5F9" }}>
            <div className="flex justify-between mb-1.5">
              <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.58rem" }}>Progres Jendela</p>
              <p style={{ color: "#2563EB", fontFamily: MONO, fontSize: "0.58rem", fontWeight: 700 }}>{progress}/{total}</p>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#F1F5F9" }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: "linear-gradient(90deg, #2563EB, #16A34A)" }}
                animate={{ width: `${(progress / total) * 100}%` }}
                transition={{ duration: 0.4 }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Diagnostics grid */}
      <div
        className="rounded-2xl p-4"
        style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", boxShadow: "0 1px 6px rgba(30,41,59,0.04)" }}
      >
        <p style={{ color: "#2563EB", fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 12 }}>
          Data Diagnostik Teknis
        </p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Skor Kepercayaan", value: isScanning ? diagScore : "—", color: isScanning ? (parseFloat(diagScore) >= 90 ? "#16A34A" : "#D97706") : "#CBD5E1" },
            { label: "Vektor Rata-Rata", value: isScanning ? diagVector : "—", color: isScanning ? "#2563EB" : "#CBD5E1" },
            { label: "Matriks Kovarians", value: isScanning ? diagCov : "—", color: isScanning ? "#2563EB" : "#CBD5E1" },
            { label: "Pembaruan Inkremental", value: isScanning ? `DIPERBARUI ${diagDelta}` : "—", color: isScanning ? "#16A34A" : "#CBD5E1" },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              className="rounded-xl p-3"
              style={{ background: "#F8FAFC", border: "1px solid #F1F5F9" }}
            >
              <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.56rem", letterSpacing: "0.06em", textTransform: "uppercase", lineHeight: 1.3 }}>
                {label}
              </p>
              <p className="mt-1.5" style={{ color, fontFamily: MONO, fontSize: "0.7rem", fontWeight: 700, lineHeight: 1.2 }}>
                {value}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
