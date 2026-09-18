import { motion } from "motion/react";
import { Loader2, CheckCircle2, Activity, ShieldCheck, Compass } from "lucide-react";
import { LiveSignalGraph } from "./LiveSignalGraph";
import { BLETelemetry } from "../context/BLEContext";

interface RegPanelProps {
  isScanning: boolean;
  progress: number;
  total: number;
  telemetry?: BLETelemetry;
  isDevMode?: boolean;
}

const MONO = "JetBrains Mono, monospace";
const SANS = "Inter, sans-serif";

export function RegPanel({ isScanning, progress, total, telemetry, isDevMode = false }: RegPanelProps) {
  const pct = Math.round((progress / total) * 100);
  const allDone = progress >= total;
  const isCalib = telemetry?.zupt?.includes("Kalibrasi") ?? false;

  return (
    <div className="flex flex-col gap-3">
      {/* Kartu Utama Pendaftaran */}
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
          <div className="flex items-center gap-2">
            <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.12em", textTransform: "uppercase" }}>
              PROGRES PENDAFTARAN · Unit A7
            </p>
            {isDevMode && (
              <span className="px-1.5 py-0.5 rounded text-[0.52rem] font-bold" style={{ background: "#FEF3C7", color: "#B45309", border: "1px solid #FDE68A", fontFamily: MONO }}>
                DEV MODE
              </span>
            )}
          </div>
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

              <p className="mt-3" style={{ color: allDone ? "#16A34A" : isCalib ? "#D97706" : "#64748B", fontFamily: SANS, fontSize: "0.82rem", fontWeight: 600 }}>
                {isCalib ? telemetry?.zupt : (allDone ? "10/10 Langkah Terpenuhi!" : "Langkah Terdeteksi")}
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

              <p className="mt-4" style={{ color: allDone ? "#16A34A" : isCalib ? "#D97706" : "#94A3B8", fontFamily: MONO, fontSize: "0.62rem", fontWeight: allDone ? 700 : 500 }}>
                {isCalib 
                  ? "Harap berdiri tenang · Sensor sedang mengunci sudut orientasi saku" 
                  : (allDone 
                    ? "100% Selesai · Menyimpan Profil GHMM ke Flash..." 
                    : (!telemetry?.isZUPTValid && progress > 0 
                      ? "Diam terdeteksi · Silakan terus berjalan secara alami" 
                      : `${pct}% selesai · Terus berjalan secara alami`))}
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
            Target Langkah
          </p>
          <p style={{ color: "#1E293B", fontFamily: MONO, fontSize: "0.68rem", fontWeight: 700 }}>
            {total} Jendela Data (3 Detik / Jendela)
          </p>
        </div>
      </div>

      {/* Dev Mode Panel untuk Registrasi */}
      {isDevMode && (
        <div
          className="rounded-2xl p-4 flex flex-col gap-3"
          style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", boxShadow: "0 1px 6px rgba(30,41,59,0.04)" }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Activity size={14} style={{ color: "#2563EB" }} />
              <p style={{ color: "#2563EB", fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 700 }}>
                Data Pelatihan Model On-Device (Dev Mode)
              </p>
            </div>
            <span className="px-1.5 py-0.5 rounded text-[0.52rem] font-bold" style={{ background: "#EFF6FF", color: "#1D4ED8", border: "1px solid #BFDBFE", fontFamily: MONO }}>
              EDGE TRAINING · RP2040
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

          {/* Matriks Status Pelatihan */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              {
                label: "Progres Kuota",
                value: isScanning ? `${progress} / ${total}` : "—",
                sub: "10 Jendela Valid",
                color: isScanning ? "#2563EB" : "#CBD5E1",
              },
              {
                label: "Status Uji ZUPT",
                value: isScanning ? (telemetry?.isZUPTValid ? "VALID (MELANGKAH)" : "DIAM / NOISE") : "—",
                sub: "Ambang Energi 0.85",
                color: isScanning ? (telemetry?.isZUPTValid ? "#16A34A" : "#F59E0B") : "#CBD5E1",
              },
              {
                label: "Kalibrasi Saku",
                value: isScanning ? "TERKUNCI (5s)" : "SIAGA",
                sub: "Roll (φ) & Pitch (θ)",
                color: isScanning ? "#16A34A" : "#CBD5E1",
              },
              {
                label: "Target Model",
                value: "GHMM (5-STATE)",
                sub: "Left-to-Right Topologi",
                color: "#64748B",
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

          {/* 5 Fitur Statistik Domain Waktu yang Sedang Diekstrak */}
          <div className="rounded-xl p-3 bg-slate-50/80 border border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.55rem", fontWeight: 700, textTransform: "uppercase" }}>
                Fitur Terkumpul pada Jendela {progress > 0 ? progress : 1}
              </p>
              <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.50rem" }}>
                100 HZ · 300 SAMPEL
              </p>
            </div>
            <div className="grid grid-cols-5 gap-1.5 text-center">
              {[
                { name: "Rata-Rata (μ)", val: telemetry?.mean ? telemetry.mean.toFixed(3) : "0.412" },
                { name: "Variansi (σ²)", val: telemetry?.variance ? telemetry.variance.toFixed(3) : "1.120" },
                { name: "Std Dev (s)", val: telemetry?.stdDev ? telemetry.stdDev.toFixed(3) : "1.058" },
                { name: "Kemiringan", val: telemetry?.skewness ? telemetry.skewness.toFixed(3) : "-0.115" },
                { name: "Keruncingan", val: telemetry?.kurtosis ? telemetry.kurtosis.toFixed(3) : "2.790" },
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

          <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-[0.58rem]">
            <span style={{ color: "#64748B", fontFamily: MONO }}>
              Target Slot Flash: <strong>Slot 0 (Pemilik Utama)</strong>
            </span>
            <span style={{ color: "#94A3B8", fontFamily: MONO }}>
              Status: {isScanning ? "Mengakumulasi..." : "Siap"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
