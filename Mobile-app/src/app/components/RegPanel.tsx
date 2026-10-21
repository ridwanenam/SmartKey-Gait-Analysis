import { motion } from "motion/react";
import { Loader2, CheckCircle2, Activity, ShieldCheck, Compass, Cpu, Layers } from "lucide-react";
import { LiveSignalGraph } from "./LiveSignalGraph";
import { BLETelemetry, LiveSample } from "../context/BLEContext";

interface RegPanelProps {
  isScanning: boolean;
  progress: number;
  total: number;
  telemetry?: BLETelemetry;
  liveSample?: LiveSample | null;
  isDevMode?: boolean;
}

const MONO = "JetBrains Mono, monospace";
const SANS = "Inter, sans-serif";

export function RegPanel({ isScanning, progress, total, telemetry, liveSample = null, isDevMode = false }: RegPanelProps) {
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
              PROGRES PENDAFTARAN · SmartKey Wearable
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

        {/* Giant counter area (Compact) */}
        <div
          className="flex flex-col items-center justify-center py-4 px-4"
          style={{ background: "#FAFBFF", minHeight: 125 }}
        >
          {isScanning ? (
            <>
              {/* Spinning or Check icon */}
              <div className="mb-2">
                {allDone ? (
                  <CheckCircle2 size={24} style={{ color: "#16A34A" }} />
                ) : (
                  <Loader2 size={22} className="animate-spin" style={{ color: "#2563EB" }} />
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
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 3 }}>
                  <span style={{
                    color: allDone ? "#16A34A" : "#2563EB",
                    fontFamily: MONO,
                    fontSize: "3.2rem",
                    fontWeight: 800,
                    lineHeight: 1,
                    letterSpacing: "-0.04em",
                  }}>
                    {progress}
                  </span>
                  <span style={{
                    color: "#CBD5E1",
                    fontFamily: MONO,
                    fontSize: "1.6rem",
                    fontWeight: 700,
                    lineHeight: 1,
                  }}>
                    / {total}
                  </span>
                </div>
              </motion.div>

              <p className="mt-1.5" style={{ color: allDone ? "#16A34A" : isCalib ? "#D97706" : "#64748B", fontFamily: SANS, fontSize: "0.75rem", fontWeight: 600 }}>
                {isCalib ? telemetry?.zupt : (allDone ? `${total}/${total} Jendela Terpenuhi!` : "Langkah Terdeteksi")}
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
                  ? "Penyelarasan Posisi Saku Otomatis (0.5s) · Bersiap Melangkah..." 
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
            {total} Jendela Data (1.5 Detik / Jendela)
          </p>
        </div>
      </div>

      {/* Dev Mode Panel untuk Registrasi */}
      {isDevMode && (
        <div
          className="rounded-2xl p-4 flex flex-col gap-3.5"
          style={{ background: "#FFFFFF", border: "1px solid #CBD5E1", boxShadow: "0 2px 10px rgba(30,41,59,0.06)" }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Activity size={15} style={{ color: "#2563EB" }} />
              <p style={{ color: "#0F172A", fontFamily: SANS, fontSize: "0.75rem", fontWeight: 700 }}>
                Telemetri Perekaman Template Gait (Registrasi)
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

          {/* KELOMPOK 1: STATUS PEREKAMAN & KUOTA TEMPLATE GAIT */}
          <div className="p-3 rounded-xl border border-slate-200/90 bg-slate-50/70">
            <div className="flex items-center gap-1.5 mb-2">
              <Cpu size={13} className="text-blue-600" />
              <p style={{ color: "#0F172A", fontFamily: SANS, fontWeight: 700, fontSize: "0.72rem" }}>
                1. Status Perekaman & Kuota Template Gait
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="p-2.5 bg-white rounded-lg border border-slate-200 shadow-2xs">
                <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.50rem", textTransform: "uppercase" }}>
                  Target Kuota Jendela
                </p>
                <p style={{ color: isScanning ? "#16A34A" : "#94A3B8", fontFamily: MONO, fontSize: "0.92rem", fontWeight: 800, marginTop: 1 }}>
                  {isScanning ? `${progress} / ${total} Jendela` : "5 Jendela Valid"}
                </p>
                <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.48rem", marginTop: 2 }}>
                  {allDone ? "100% Selesai Terkumpul" : "Akumulasi Langkah Nyata"}
                </p>
              </div>

              <div className="p-2.5 bg-white rounded-lg border border-slate-200 shadow-2xs">
                <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.50rem", textTransform: "uppercase" }}>
                  Slot Pengguna Terdaftar
                </p>
                <p style={{ color: "#2563EB", fontFamily: MONO, fontSize: "0.85rem", fontWeight: 800, marginTop: 1 }}>
                  Slot 1 (Pemilik Utama)
                </p>
                <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.48rem", marginTop: 2 }}>
                  Tersimpan di Flash RP2040
                </p>
              </div>

              <div className="p-2.5 bg-white rounded-lg border border-slate-200 shadow-2xs">
                <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.50rem", textTransform: "uppercase" }}>
                  Status Model Awal
                </p>
                <p style={{ color: allDone ? "#16A34A" : "#059669", fontFamily: MONO, fontSize: "0.85rem", fontWeight: 800, marginTop: 1 }}>
                  GHMM (5-STATE)
                </p>
                <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.48rem", marginTop: 2 }}>
                  Left-to-Right Topologi
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
                  2. Vektor Ciri 5-Fitur Jendela Aktif #{progress > 0 ? progress : 1}
                </p>
              </div>
              <span style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.50rem" }}>
                100 HZ · 150 SAMPEL
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

          {/* KELOMPOK 3: ORIENTASI SAKU & KEADAAN SENSOR */}
          <div className="p-3 rounded-xl border border-slate-200/90 bg-slate-50/70">
            <div className="flex items-center gap-1.5 mb-2">
              <Compass size={13} className="text-amber-600" />
              <p style={{ color: "#0F172A", fontFamily: SANS, fontWeight: 700, fontSize: "0.72rem" }}>
                3. Orientasi Saku & Keadaan Sensor
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="p-2.5 bg-white rounded-lg border border-slate-200 shadow-2xs">
                <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.50rem", textTransform: "uppercase" }}>
                  Kalibrasi Saku (0.5s)
                </p>
                <p style={{ color: isScanning ? "#16A34A" : "#94A3B8", fontFamily: MONO, fontSize: "0.78rem", fontWeight: 800, marginTop: 1 }}>
                  {isScanning ? (isCalib ? "MENYELARASKAN..." : "TERKUNCI OTOMATIS") : "SIAGA"}
                </p>
                <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.48rem", marginTop: 2 }}>
                  Roll (φ) & Pitch (θ)
                </p>
              </div>

              <div className="p-2.5 bg-white rounded-lg border border-slate-200 shadow-2xs">
                <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.50rem", textTransform: "uppercase" }}>
                  Status Uji ZUPT
                </p>
                <p style={{ color: isScanning ? ((liveSample ? liveSample.isMoving : telemetry?.isZUPTValid) ? "#16A34A" : "#D97706") : "#94A3B8", fontFamily: MONO, fontSize: "0.78rem", fontWeight: 800, marginTop: 1 }}>
                  {isScanning
                    ? ((liveSample ? liveSample.isMoving : telemetry?.isZUPTValid) ? "● VALID (MELANGKAH)" : "○ DIAM / STATIS")
                    : "—"}
                </p>
                <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.48rem", marginTop: 2 }}>
                  Rotasi Gyro &gt; 0.85 (rad/s)²
                </p>
              </div>

              <div className="p-2.5 bg-white rounded-lg border border-slate-200 shadow-2xs">
                <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.50rem", textTransform: "uppercase" }}>
                  Model Adaptation
                </p>
                <p style={{ color: "#2563EB", fontFamily: MONO, fontSize: "0.78rem", fontWeight: 800, marginTop: 1 }}>
                  BASELINE MURNI
                </p>
                <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.48rem", marginTop: 2 }}>
                  Tanpa Inkremental EMA
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
