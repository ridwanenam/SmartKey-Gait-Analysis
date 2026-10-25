import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Loader2, Activity, Cpu, Layers, Zap, CheckCircle, AlertTriangle } from "lucide-react";
import { LiveSignalGraph } from "./LiveSignalGraph";
import { BLETelemetry, LiveSample } from "../context/BLEContext";

interface AuthScanPanelProps {
  isScanning: boolean;
  progress: number;
  total: number;
  diagScore: string;
  diagVector: string;
  diagCov: string;
  diagDelta: string;
  telemetry?: BLETelemetry;
  liveSample?: LiveSample | null;
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
  liveSample = null,
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
            STATUS PEMINDAIAN · SmartKey Wearable
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

        {/* Scanning area (Compact) */}
        <div
          className="relative overflow-hidden flex flex-col items-center justify-center py-3 px-4"
          style={{ height: 110, background: isScanning ? "#F8FAFC" : "#FAFAFA" }}
        >
          {/* Horizontal scan lines background */}
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="absolute left-0 right-0"
              style={{
                top: `${(i + 1) * 16}%`,
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
              style={{ height: 30, background: "linear-gradient(180deg, transparent, rgba(37,99,235,0.06), transparent)", zIndex: 1, pointerEvents: "none" }}
              animate={{ top: ["5%", "85%", "5%"] }}
              transition={{ duration: 2.4, ease: "easeInOut", repeat: Infinity }}
            />
          )}

          {/* Center content */}
          <div className="relative z-10 text-center px-4">
            {isScanning ? (
              <>
                {telemetry?.zupt?.includes("Menyelaraskan") ? (
                  <>
                    <div className="flex items-center justify-center gap-1.5 mb-0.5">
                      <Loader2 size={13} className="animate-spin" style={{ color: "#D97706" }} />
                      <p style={{ color: "#D97706", fontFamily: MONO, fontWeight: 700, fontSize: "0.68rem", letterSpacing: "0.06em" }}>
                        MENYELARASKAN POSISI SAKU...
                      </p>
                    </div>
                    <p style={{ color: "#1E293B", fontFamily: SANS, fontSize: "0.78rem", fontWeight: 600 }}>
                      Mengunci Sudut Sensor Otomatis
                    </p>
                    <p className="mt-1" style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.62rem" }}>
                      Persiapan Deteksi Gait Biometrik
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-center gap-1.5 mb-0.5">
                      <Loader2 size={13} className="animate-spin" style={{ color: "#2563EB" }} />
                      <p style={{ color: "#2563EB", fontFamily: MONO, fontWeight: 700, fontSize: "0.68rem", letterSpacing: "0.06em" }}>
                        {progress === 0 ? "SILAKAN BERJALAN NORMAL" : "MEMINDAI GAYA BERJALAN..."}
                      </p>
                    </div>
                    <p style={{ color: "#1E293B", fontFamily: SANS, fontSize: "0.78rem", fontWeight: 600 }}>
                      {progress === 0 ? "Sensor Siap Menganalisis Langkah" : "Sedang Menganalisis Pola Langkah"}
                    </p>
                    <p className="mt-1" style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.62rem" }}>
                      Langkah Terdeteksi:{" "}
                      <span style={{ color: "#2563EB", fontWeight: 700 }}>{progress}/{total}</span>
                      {telemetry && !telemetry.isZUPTValid && progress > 0 && (
                        <span style={{ color: "#D97706", marginLeft: 6 }}>· (Diam)</span>
                      )}
                    </p>
                  </>
                )}
              </>
            ) : (
              <p style={{ color: "#94A3B8", fontFamily: SANS, fontSize: "0.75rem" }}>
                Sistem siap · Tekan tombol untuk memulai
              </p>
            )}
          </div>

          {/* Corner brackets */}
          {["top-2 left-2", "top-2 right-2", "bottom-2 left-2", "bottom-2 right-2"].map((pos, i) => (
            <div
              key={i}
              className={`absolute ${pos} w-3.5 h-3.5`}
              style={{
                borderColor: isScanning ? "rgba(37,99,235,0.35)" : "#E2E8F0",
                borderStyle: "solid",
                borderWidth: i === 0 ? "2px 0 0 2px" : i === 1 ? "2px 2px 0 0" : i === 2 ? "0 0 2px 2px" : "0 2px 2px 0",
                borderRadius: i === 0 ? "5px 0 0 0" : i === 1 ? "0 5px 0 0" : i === 2 ? "0 0 0 5px" : "0 0 5px 0",
              }}
            />
          ))}
        </div>

        {/* Progress bar */}
        {isScanning && (
          <div className="px-4 py-2" style={{ borderTop: "1px solid #F1F5F9" }}>
            <div className="flex justify-between mb-1">
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
          className="rounded-2xl p-4 flex flex-col gap-3.5"
          style={{ background: "#FFFFFF", border: "1px solid #CBD5E1", boxShadow: "0 2px 10px rgba(30,41,59,0.06)" }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Activity size={15} style={{ color: "#2563EB" }} />
              <p style={{ color: "#0F172A", fontFamily: SANS, fontSize: "0.75rem", fontWeight: 700 }}>
                Telemetri Real-Time Edge AI (Autentikasi)
              </p>
            </div>
            <span className="px-2 py-0.5 rounded text-[0.52rem] font-bold" style={{ background: "#EFF6FF", color: "#1D4ED8", border: "1px solid #BFDBFE", fontFamily: MONO }}>
              20 HZ · REAL-TIME BLE
            </span>
          </div>

          {/* Sinyal Kinematika Real-Time Waveform (Dual-Axis) */}
          <LiveSignalGraph
            isScanning={isScanning}
            isZUPTValid={telemetry?.isZUPTValid ?? false}
            liveSample={liveSample}
            mean={telemetry?.mean || 0}
            variance={telemetry?.variance || 0}
            stdDev={telemetry?.stdDev || 0}
            kurtosis={telemetry?.kurtosis || 0}
            sampleRate={20}
            height={190}
          />

          {/* KELOMPOK 1: INFERENSI & KEPUTUSAN GHMM */}
          <div className="p-3 rounded-xl border border-slate-200/90 bg-slate-50/70">
            <div className="flex items-center gap-1.5 mb-2">
              <Cpu size={13} className="text-blue-600" />
              <p style={{ color: "#0F172A", fontFamily: SANS, fontWeight: 700, fontSize: "0.72rem" }}>
                1. Inferensi GHMM & Evaluasi Keputusan
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="p-2.5 bg-white rounded-lg border border-slate-200 shadow-2xs">
                <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.50rem", textTransform: "uppercase" }}>
                  Skor Keyakinan (CIR)
                </p>
                <p style={{ color: isScanning ? ((telemetry?.confidenceScore ?? parseFloat(diagScore)) >= 80.0 ? "#16A34A" : "#DC2626") : "#94A3B8", fontFamily: MONO, fontSize: "0.92rem", fontWeight: 800, marginTop: 1 }}>
                  {isScanning ? (telemetry?.confidenceScore ? `${telemetry.confidenceScore.toFixed(1)}%` : `${diagScore}%`) : "—"}
                </p>
                <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.48rem", marginTop: 2 }}>
                  {isScanning ? ((telemetry?.confidenceScore ?? parseFloat(diagScore)) >= 80.0 ? "Lolos Ambang (≥80.0%)" : "Ditolak (<80.0%)") : "Ambang Min: 80.0%"}
                </p>
              </div>

              <div className="p-2.5 bg-white rounded-lg border border-slate-200 shadow-2xs">
                <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.50rem", textTransform: "uppercase" }}>
                  Log-Likelihood (ln αT)
                </p>
                <p style={{ color: isScanning ? "#2563EB" : "#94A3B8", fontFamily: MONO, fontSize: "0.92rem", fontWeight: 800, marginTop: 1 }}>
                  {isScanning ? (progress > 0 && telemetry?.logLikelihood ? telemetry.logLikelihood.toFixed(2) : "Menghitung...") : "—"}
                </p>
                <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.48rem", marginTop: 2 }}>
                  Forward Algorithm GHMM
                </p>
              </div>

              <div className="p-2.5 bg-white rounded-lg border border-slate-200 shadow-2xs">
                <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.50rem", textTransform: "uppercase" }}>
                  Ambang Dinamis (Th)
                </p>
                <p style={{ color: isScanning ? "#D97706" : "#94A3B8", fontFamily: MONO, fontSize: "0.92rem", fontWeight: 800, marginTop: 1 }}>
                  {isScanning ? (progress > 0 && telemetry?.adaptiveThreshold ? telemetry.adaptiveThreshold.toFixed(2) : "—") : "—"}
                </p>
                <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.48rem", marginTop: 2 }}>
                  Peak Tracking (Margin 1.15x)
                </p>
              </div>
            </div>
          </div>

          {/* KELOMPOK 2: VEKTOR CIRI 5-FITUR (FEATURE EXTRACTION) */}
          <div className="p-3 rounded-xl border border-slate-200/90 bg-slate-50/70">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Layers size={13} className="text-emerald-600" />
                <p style={{ color: "#0F172A", fontFamily: SANS, fontWeight: 700, fontSize: "0.72rem" }}>
                  2. Vektor Ciri 5-Fitur Biometrik (Jendela 1.5s)
                </p>
              </div>
              <span style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.50rem" }}>
                N = 150 SAMPEL
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-left">
              <div className="p-2 bg-white rounded-lg border border-slate-200 shadow-2xs">
                <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.48rem", textTransform: "uppercase" }}>Mean Gyro (μ)</p>
                <p style={{ color: "#0F172A", fontFamily: MONO, fontSize: "0.78rem", fontWeight: 800, marginTop: 1 }}>
                  {isScanning && progress > 0 && telemetry?.mean !== undefined ? `${telemetry.mean.toFixed(1)}°/s` : "—"}
                </p>
                <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.45rem" }}>Rata-rata Putaran</p>
              </div>

              <div className="p-2 bg-white rounded-lg border border-slate-200 shadow-2xs">
                <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.48rem", textTransform: "uppercase" }}>Variansi (σ²)</p>
                <p style={{ color: "#0F172A", fontFamily: MONO, fontSize: "0.78rem", fontWeight: 800, marginTop: 1 }}>
                  {isScanning && progress > 0 && telemetry?.variance !== undefined ? telemetry.variance.toFixed(1) : "—"}
                </p>
                <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.45rem" }}>Dinamika Putaran</p>
              </div>

              <div className="p-2 bg-white rounded-lg border border-slate-200 shadow-2xs">
                <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.48rem", textTransform: "uppercase" }}>Cadence (R)</p>
                <p style={{ color: "#0F172A", fontFamily: MONO, fontSize: "0.78rem", fontWeight: 800, marginTop: 1 }}>
                  {isScanning && progress > 0 && telemetry?.stdDev !== undefined ? `${telemetry.stdDev.toFixed(1)}%` : "—"}
                </p>
                <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.45rem" }}>Keteraturan Irama</p>
              </div>

              <div className="p-2 bg-white rounded-lg border border-slate-200 shadow-2xs">
                <p style={{ color: "#0891B2", fontFamily: MONO, fontSize: "0.48rem", textTransform: "uppercase" }}>Periode (k)</p>
                <p style={{ color: "#0891B2", fontFamily: MONO, fontSize: "0.78rem", fontWeight: 800, marginTop: 1 }}>
                  {isScanning && progress > 0 && telemetry?.skewness !== undefined ? `${telemetry.skewness.toFixed(0)} smp` : "—"}
                </p>
                <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.45rem" }}>Lag Autokorelasi</p>
              </div>

              <div className="p-2 bg-white rounded-lg border border-slate-200 shadow-2xs col-span-2 sm:col-span-1">
                <p style={{ color: "#7C3AED", fontFamily: MONO, fontSize: "0.48rem", textTransform: "uppercase" }}>Hentakan (Acc)</p>
                <p style={{ color: "#7C3AED", fontFamily: MONO, fontSize: "0.78rem", fontWeight: 800, marginTop: 1 }}>
                  {isScanning && progress > 0 && telemetry?.kurtosis !== undefined ? `${telemetry.kurtosis.toFixed(1)} %g` : "—"}
                </p>
                <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.45rem" }}>Ground Reaction</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
