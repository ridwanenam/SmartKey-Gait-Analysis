import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Loader2, Activity, Zap, CheckCircle, AlertTriangle } from "lucide-react";
import { LiveSignalGraph } from "./LiveSignalGraph";
import { BLETelemetry } from "../context/BLEContext";

interface AuthScanPanelProps {
  isScanning: boolean;
  progress: number;
  total: number;
  diagScore: string;
  diagVector: string;
  diagCov: string;
  diagDelta: string;
  telemetry?: BLETelemetry;
  isDevMode?: boolean;
}

const MONO = "JetBrains Mono, monospace";
const SANS = "Inter, sans-serif";

export function AuthScanPanel({
  isScanning,
  progress,
  total,
  diagScore,
  diagVector,
  diagCov,
  diagDelta,
  telemetry,
  isDevMode = false,
}: AuthScanPanelProps) {
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
                  Langkah Terdeteksi:{" "}
                  <span style={{ color: "#2563EB", fontWeight: 700 }}>{progress}/{total}</span>
                </p>
                {telemetry && !telemetry.isZUPTValid && progress > 0 && (
                  <p className="mt-1" style={{ color: "#D97706", fontFamily: MONO, fontSize: "0.58rem" }}>
                    Diam terdeteksi · Terus berjalan alami
                  </p>
                )}
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
              <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.58rem" }}>Progres Langkah</p>
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

      {/* Diagnostics grid (Hanya muncul jika Mode Pengembang Aktif) */}
      {isDevMode && (
        <div
          className="rounded-2xl p-4 flex flex-col gap-3"
          style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", boxShadow: "0 1px 6px rgba(30,41,59,0.04)" }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Activity size={14} style={{ color: "#D97706" }} />
              <p style={{ color: "#D97706", fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 700 }}>
                Data Diagnostik Edge AI (Dev Mode)
              </p>
            </div>
            <span className="px-1.5 py-0.5 rounded text-[0.52rem] font-bold" style={{ background: "#FEF3C7", color: "#B45309", border: "1px solid #FDE68A", fontFamily: MONO }}>
              100 HZ · REAL-TIME
            </span>
          </div>

          {/* Sinyal Kinematika Real-Time Waveform */}
          <LiveSignalGraph
            isScanning={isScanning}
            isZUPTValid={telemetry?.isZUPTValid ?? true}
            mean={telemetry?.mean || 0.42}
            variance={telemetry?.variance || 1.15}
            stdDev={telemetry?.stdDev || 1.07}
            kurtosis={telemetry?.kurtosis || 2.8}
            sampleRate={100}
            height={130}
          />

          {/* Matriks Parameter Ilmiah */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              {
                label: "Skor Keyakinan (CIR)",
                value: isScanning ? (telemetry?.confidenceScore ? `${telemetry.confidenceScore.toFixed(1)}%` : diagScore) : "—",
                sub: "Ambang Min: 80.0%",
                color: isScanning ? ((telemetry?.confidenceScore ?? parseFloat(diagScore)) >= 80.0 ? "#16A34A" : "#DC2626") : "#CBD5E1",
              },
              {
                label: "Log-Likelihood (αt)",
                value: isScanning ? (telemetry?.logLikelihood ? telemetry.logLikelihood.toFixed(2) : "-142.10") : "—",
                sub: "Forward GHMM",
                color: isScanning ? "#2563EB" : "#CBD5E1",
              },
              {
                label: "Ambang Dinamis (Th)",
                value: isScanning ? (telemetry?.adaptiveThreshold ? telemetry.adaptiveThreshold.toFixed(2) : "-150.00") : "—",
                sub: "Peak Tracking (1.15x)",
                color: isScanning ? "#D97706" : "#CBD5E1",
              },
              {
                label: "Status Gerak ZUPT",
                value: isScanning ? (telemetry?.isZUPTValid ? "VALID (MELANGKAH)" : "DIAM / NOISE") : "—",
                sub: "Uji Energi 0.85",
                color: isScanning ? (telemetry?.isZUPTValid ? "#16A34A" : "#F59E0B") : "#CBD5E1",
              },
            ].map(({ label, value, sub, color }) => (
              <div
                key={label}
                className="rounded-xl p-2.5"
                style={{ background: "#F8FAFC", border: "1px solid #F1F5F9" }}
              >
                <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.52rem", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                  {label}
                </p>
                <p className="mt-1" style={{ color, fontFamily: MONO, fontSize: "0.72rem", fontWeight: 700 }}>
                  {value}
                </p>
                <p className="mt-0.5" style={{ color: "#CBD5E1", fontFamily: MONO, fontSize: "0.50rem" }}>
                  {sub}
                </p>
              </div>
            ))}
          </div>

          {/* 5 Fitur Statistik Domain Waktu */}
          <div className="rounded-xl p-3 bg-slate-50/80 border border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.55rem", fontWeight: 700, textTransform: "uppercase" }}>
                5 Fitur Statistik Domain Waktu (Jendela 3 Detik)
              </p>
              <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.50rem" }}>
                N = 300 SAMPEL
              </p>
            </div>
            <div className="grid grid-cols-5 gap-1.5 text-center">
              {[
                { name: "Rata-Rata (μ)", val: telemetry?.mean ? telemetry.mean.toFixed(3) : "0.428" },
                { name: "Variansi (σ²)", val: telemetry?.variance ? telemetry.variance.toFixed(3) : "1.152" },
                { name: "Std Dev (s)", val: telemetry?.stdDev ? telemetry.stdDev.toFixed(3) : "1.073" },
                { name: "Kemiringan", val: telemetry?.skewness ? telemetry.skewness.toFixed(3) : "-0.142" },
                { name: "Keruncingan", val: telemetry?.kurtosis ? telemetry.kurtosis.toFixed(3) : "2.845" },
              ].map(({ name, val }) => (
                <div key={name} className="bg-white rounded-lg p-1.5 border border-slate-200/60 shadow-2xs">
                  <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.48rem" }}>{name}</p>
                  <p style={{ color: isScanning ? "#1E293B" : "#94A3B8", fontFamily: MONO, fontSize: "0.62rem", fontWeight: 700, marginTop: 2 }}>
                    {isScanning ? val : "—"}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Footer Baris Status Pembelajaran Adaptif */}
          <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-[0.58rem]">
            <span style={{ color: "#64748B", fontFamily: MONO }}>
              Adaptasi Model (EMA Δμ):{" "}
              <strong style={{ color: isScanning ? "#16A34A" : "#94A3B8" }}>
                {isScanning ? (telemetry?.emaDelta !== undefined ? `${telemetry.emaDelta >= 0 ? "+" : ""}${telemetry.emaDelta.toFixed(3)}` : `DIPERBARUI ${diagDelta}`) : "—"}
              </strong>
            </span>
            <span style={{ color: "#94A3B8", fontFamily: MONO }}>
              Kovariansi: {isScanning ? diagCov : "—"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
