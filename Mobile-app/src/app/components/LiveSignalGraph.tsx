import React, { useEffect, useRef } from "react";

interface LiveSignalGraphProps {
  isScanning: boolean;
  isZUPTValid?: boolean;
  mean?: number;
  variance?: number;
  stdDev?: number;
  kurtosis?: number;
  sampleRate?: number;
  height?: number;
}

const MONO = "JetBrains Mono, monospace";

export function LiveSignalGraph({
  isScanning,
  isZUPTValid = true,
  mean = 0.42,
  variance = 1.15,
  stdDev = 1.07,
  kurtosis = 2.8,
  sampleRate = 100,
  height = 135,
}: LiveSignalGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const phaseRef = useRef<number>(0);
  const historyRef = useRef<number[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Buffer history points for smooth scrolling wave
    const maxPoints = 120;
    if (historyRef.current.length === 0) {
      historyRef.current = new Array(maxPoints).fill(0);
    }

    let lastTime = performance.now();

    function render(time: number) {
      if (!canvas || !ctx) return;

      const dt = (time - lastTime) / 1000;
      lastTime = time;

      const width = canvas.width;
      const h = canvas.height;
      const cy = h / 2;

      ctx.clearRect(0, 0, width, h);

      // 1. Gambar Background Osiloskop & Grid Grid
      ctx.fillStyle = "#0F172A"; // Dark slate oscilloscope screen
      ctx.fillRect(0, 0, width, h);

      // Grid Horizontal
      ctx.strokeStyle = "rgba(51, 65, 85, 0.4)";
      ctx.lineWidth = 1;
      const gridRows = 4;
      for (let i = 1; i < gridRows; i++) {
        const y = (h / gridRows) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Garis Tengah Referensi (Center Line / 0 rad/s)
      ctx.strokeStyle = "rgba(100, 116, 139, 0.6)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.lineTo(width, cy);
      ctx.stroke();
      ctx.setLineDash([]);

      // Garis Grid Vertikal
      const gridCols = 8;
      for (let i = 1; i < gridCols; i++) {
        const x = (width / gridCols) * i;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      // 2. Kalkulasi Nilai Gelombang Baru Berdasarkan Data Kinematika
      if (isScanning) {
        phaseRef.current += dt * 5.2; // Frekuensi siklus langkah (~1.8 Hz)
        const phase = phaseRef.current;

        let newSample = 0;
        if (isZUPTValid) {
          // Pola sinusoidal langkah berjalan manusia:
          // Puncak tajam heel-strike (kurtosis) + ayunan kaki (swing phase)
          const heelStrike = Math.pow(Math.sin(phase), 3) * (kurtosis > 0 ? Math.min(kurtosis, 4) : 2.5);
          const swingPhase = Math.sin(phase * 2) * 0.45;
          const noise = (Math.random() - 0.5) * (stdDev > 0 ? Math.min(stdDev * 0.15, 0.3) : 0.08);

          // Scaling amplitudo berdasarkan mean magnitude & variansi aktual
          const scale = Math.max(0.4, Math.min(mean * 1.6 + variance * 0.4, 1.8));
          newSample = (heelStrike + swingPhase + noise) * scale * (h * 0.22);
        } else {
          // Diam / Istirahat (ZUPT gate: Flatline dengan derau getaran kain minim)
          newSample = (Math.random() - 0.5) * 3;
        }

        historyRef.current.push(newSample);
        if (historyRef.current.length > maxPoints) {
          historyRef.current.shift();
        }
      } else {
        // Idle Standby (Garis lurus tenang)
        historyRef.current.push(0);
        if (historyRef.current.length > maxPoints) {
          historyRef.current.shift();
        }
      }

      // 3. Gambar Gelombang Sinyal Kinematika
      const pts = historyRef.current;
      const stepX = width / (maxPoints - 1);

      // Path kurva sinyal
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const x = i * stepX;
        const y = cy - pts[i];
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      // Warna garis sinyal (Hijau jika Melangkah Valid, Oranye jika Diam/ZUPT, Slate jika Standby)
      const strokeColor = isScanning
        ? isZUPTValid
          ? "#22C55E" // Hijau neon saat melangkah valid
          : "#F59E0B" // Oranye saat diam / tidak lolos ZUPT
        : "#64748B"; // Abu-abu saat standby

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2.2;
      ctx.shadowColor = strokeColor;
      ctx.shadowBlur = isScanning ? 6 : 0;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Area gradient halus di bawah kurva sinyal
      ctx.lineTo(width, cy);
      ctx.lineTo(0, cy);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, isScanning ? (isZUPTValid ? "rgba(34, 197, 94, 0.15)" : "rgba(245, 158, 11, 0.12)") : "rgba(100, 116, 139, 0.05)");
      grad.addColorStop(1, "rgba(15, 23, 42, 0)");
      ctx.fillStyle = grad;
      ctx.fill();

      // 4. Gambar Ambang Batas ZUPT (Threshold Line)
      const zuptY = cy - (h * 0.26);
      ctx.strokeStyle = "rgba(239, 68, 68, 0.45)"; // Garis merah ZUPT threshold
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(0, zuptY);
      ctx.lineTo(width, zuptY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label teks indikator di dalam canvas
      ctx.font = `600 9px ${MONO}`;
      ctx.fillStyle = "rgba(148, 163, 184, 0.75)";
      ctx.fillText(`RATE: ${sampleRate} Hz`, 10, 16);
      ctx.fillText(`AMBANG ZUPT`, width - 82, zuptY - 4);

      if (isScanning) {
        ctx.fillStyle = isZUPTValid ? "#4ADE80" : "#FBBF24";
        ctx.fillText(isZUPTValid ? "● FASE LANGKAH AKTIF" : "○ DIAM / ZUPT GATE", 10, h - 10);
      }

      animRef.current = requestAnimationFrame(render);
    }

    animRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animRef.current);
    };
  }, [isScanning, isZUPTValid, mean, variance, stdDev, kurtosis, sampleRate]);

  return (
    <div
      className="relative rounded-xl overflow-hidden border border-slate-700/60 shadow-inner"
      style={{ background: "#0F172A" }}
    >
      <div className="absolute top-2 right-2.5 z-10 flex items-center gap-1.5 bg-slate-900/80 px-2 py-0.5 rounded border border-slate-700/50">
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: isScanning ? (isZUPTValid ? "#22C55E" : "#F59E0B") : "#64748B" }}
        />
        <span style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.58rem", fontWeight: 600 }}>
          OSILOSKOP GAIT
        </span>
      </div>

      <canvas
        ref={canvasRef}
        width={480}
        height={height}
        className="w-full block"
        style={{ height }}
      />
    </div>
  );
}
