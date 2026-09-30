import React, { useEffect, useRef, useState } from "react";
import { LiveSample } from "../context/BLEContext";

interface LiveSignalGraphProps {
  isScanning: boolean;
  isZUPTValid?: boolean;
  liveSample?: LiveSample | null;
  mean?: number;
  variance?: number;
  stdDev?: number;
  kurtosis?: number;
  sampleRate?: number;
  height?: number;
}

interface LivePoint {
  val: number;     // Akselerasi linier dinamis (g)
  energy: number;  // Energi rotasi giroskop (rad/s)^2
  isMoving: boolean;
}

const MONO = "JetBrains Mono, monospace";

export function LiveSignalGraph({
  isScanning,
  isZUPTValid = false,
  liveSample = null,
  mean = 0,
  variance = 0,
  stdDev = 0,
  kurtosis = 0,
  sampleRate = 20,
  height = 195,
}: LiveSignalGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const historyRef = useRef<LivePoint[]>([]);
  const latestLiveSampleRef = useRef<LiveSample | null>(null);

  // Toggle channel sinyal
  const [showAccel, setShowAccel] = useState<boolean>(true);
  const [showGyro, setShowGyro] = useState<boolean>(true);
  const showAccelRef = useRef<boolean>(true);
  const showGyroRef = useRef<boolean>(true);

  useEffect(() => {
    showAccelRef.current = showAccel;
  }, [showAccel]);

  useEffect(() => {
    showGyroRef.current = showGyro;
  }, [showGyro]);

  // Auto-scaling adaptif sumbu Y Kiri (Akselerometer g) dan Sumbu Y Kanan (Giroskop)
  const smoothYLimitRef = useRef<number>(2.0);
  const smoothGyroLimitRef = useRef<number>(5.0);

  // Waktu berjalan adaptif sumbu X
  const scanStartTimeRef = useRef<number>(0);

  // Buffer 30 poin data (pada 20 Hz: 30 sample x 50ms = tepat 1.5 detik rolling window)
  const maxPoints = 30;

  // Tangkap setiap paket live sample 20 Hz dari hardware RP2040
  useEffect(() => {
    latestLiveSampleRef.current = liveSample;
    if (liveSample && isScanning) {
      historyRef.current.push({
        val: liveSample.liveVal,
        energy: liveSample.energy,
        isMoving: liveSample.isMoving,
      });
      if (historyRef.current.length > maxPoints) {
        historyRef.current.shift();
      }
    }
  }, [liveSample, isScanning]);

  // Reset timer waktu berjalan saat status scanning berubah
  useEffect(() => {
    if (isScanning) {
      if (scanStartTimeRef.current === 0) {
        scanStartTimeRef.current = performance.now();
      }
    } else {
      scanStartTimeRef.current = 0;
    }
  }, [isScanning]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (historyRef.current.length === 0) {
      historyRef.current = Array.from({ length: maxPoints }, () => ({
        val: 0,
        energy: 0.05,
        isMoving: false,
      }));
    }

    let lastScrollTime = performance.now();

    function render(time: number) {
      if (!canvas || !ctx) return;

      const width = canvas.width;
      const h = canvas.height;

      // Layout margin untuk dua sumbu Y
      const padLeft = 44;   // Ruang label sumbu Y Kiri (Akselerasi 'g')
      const padRight = 58;  // Ruang label sumbu Y Kanan (Rotasi Gyro '(rad/s)²')
      const padTop = 24;    // Ruang header atas
      const padBottom = 22; // Ruang sumbu X waktu

      const plotW = width - padLeft - padRight;
      const plotH = h - padTop - padBottom;
      const plotCy = padTop + plotH / 2;
      const maxPlotAmp = (plotH / 2) * 0.85;

      // Scroll halus saat standby
      if (!isScanning) {
        if (time - lastScrollTime > 50) {
          lastScrollTime = time;
          historyRef.current.push({
            val: 0,
            energy: 0.05,
            isMoving: false,
          });
          if (historyRef.current.length > maxPoints) {
            historyRef.current.shift();
          }
        }
      }

      ctx.clearRect(0, 0, width, h);

      // 1. Background Osiloskop
      ctx.fillStyle = "#0B1329";
      ctx.fillRect(0, 0, width, h);

      // Area Plot Sinyal
      ctx.fillStyle = "#090F1F";
      ctx.fillRect(padLeft, padTop, plotW, plotH);

      // 2. Hitung Batas Sumbu Y Kiri Adaptif (Akselerometer Linier 'g')
      const pts = historyRef.current;
      let currentPeak = 2.0;
      for (let i = 0; i < pts.length; i++) {
        const absVal = Math.abs(pts[i].val);
        if (absVal > currentPeak) {
          currentPeak = absVal;
        }
      }
      const targetYLimit = Math.max(2.0, Math.ceil(currentPeak * 1.15 * 2) / 2);
      smoothYLimitRef.current += (targetYLimit - smoothYLimitRef.current) * 0.08;
      const yLimitAcc = smoothYLimitRef.current;
      const halfLimitAcc = yLimitAcc / 2;

      // Batas Sumbu Y Kanan Adaptif (Rotasi Giroskop, dinamis tanpa clipping)
      let currentGyroPeak = 4.0;
      for (let i = 0; i < pts.length; i++) {
        if (pts[i].energy > currentGyroPeak) {
          currentGyroPeak = pts[i].energy;
        }
      }
      const rawGyroLimit = currentGyroPeak * 1.25;
      let targetGyroLimit = 4.0;
      if (rawGyroLimit < 6.0) {
        targetGyroLimit = 5.0;
      } else if (rawGyroLimit < 50.0) {
        targetGyroLimit = Math.ceil(rawGyroLimit / 5) * 5;
      } else if (rawGyroLimit < 200.0) {
        targetGyroLimit = Math.ceil(rawGyroLimit / 20) * 20;
      } else if (rawGyroLimit < 1000.0) {
        targetGyroLimit = Math.ceil(rawGyroLimit / 100) * 100;
      } else {
        targetGyroLimit = Math.ceil(rawGyroLimit / 500) * 500;
      }
      smoothGyroLimitRef.current += (targetGyroLimit - smoothGyroLimitRef.current) * 0.08;
      const gyroLimit = smoothGyroLimitRef.current;

      const formatRightVal = (val: number) => {
        if (val >= 1000) {
          return val % 1000 === 0 ? `${val / 1000}k` : `${(val / 1000).toFixed(1)}k`;
        }
        return val.toFixed(val < 10 ? 1 : 0);
      };

      // 3. Grid Horizontal & Label Sumbu Y Kiri (Akselerasi 'g')
      ctx.lineWidth = 1;
      const yTicksLeft = [
        { val: `+${yLimitAcc.toFixed(1)}g`, ratio: 0.0 },
        { val: `+${halfLimitAcc.toFixed(1)}g`, ratio: 0.25 },
        { val: " 0.0g", ratio: 0.5, isZero: true },
        { val: `-${halfLimitAcc.toFixed(1)}g`, ratio: 0.75 },
        { val: `-${yLimitAcc.toFixed(1)}g`, ratio: 1.0 },
      ];

      ctx.font = `600 7.5px ${MONO}`;
      yTicksLeft.forEach(({ val, ratio, isZero }) => {
        const y = padTop + plotH * ratio;

        ctx.strokeStyle = isZero ? "rgba(71, 85, 105, 0.7)" : "rgba(30, 41, 59, 0.6)";
        if (isZero) ctx.setLineDash([3, 3]);
        else ctx.setLineDash([]);

        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(padLeft + plotW, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label teks di kiri (Akselerometer g)
        ctx.fillStyle = isZero ? "rgba(148, 163, 184, 0.85)" : "rgba(148, 163, 184, 0.5)";
        ctx.textAlign = "right";
        ctx.fillText(val, padLeft - 5, y + 2.5);
      });

      // 4. Label Sumbu Y Kanan (Energi Rotasi Gyro Adaptif)
      const yTicksRight = [
        { val: `${formatRightVal(gyroLimit)}`, ratio: 0.0 },
        { val: `${formatRightVal(gyroLimit / 2)}`, ratio: 0.5 },
        { val: "0.0", ratio: 1.0 },
      ];
      yTicksRight.forEach(({ val, ratio }) => {
        const y = padTop + plotH * ratio;
        ctx.fillStyle = "rgba(245, 158, 11, 0.75)";
        ctx.textAlign = "left";
        ctx.fillText(val, padLeft + plotW + 5, y + 2.5);
      });

      // Garis Ambang Batas ZUPT Giroskop 0.85 pada skala kanan
      const zuptRatio = 1.0 - (0.85 / gyroLimit);
      if (zuptRatio >= 0.05 && zuptRatio <= 0.95) {
        const yZuptLine = padTop + plotH * zuptRatio;
        ctx.strokeStyle = "rgba(245, 158, 11, 0.35)";
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(padLeft, yZuptLine);
        ctx.lineTo(padLeft + plotW, yZuptLine);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(245, 158, 11, 0.65)";
        ctx.textAlign = "right";
        ctx.fillText("AMBANG ZUPT (0.85)", padLeft + plotW - 6, yZuptLine - 3);
      }

      // 5. Grid Vertikal & Label Sumbu X Adaptif (Waktu Berjalan Real-Time)
      const elapsedSec = isScanning && scanStartTimeRef.current > 0
        ? (time - scanStartTimeRef.current) / 1000
        : 0;

      const windowDuration = 1.5;
      const tEnd = Math.max(windowDuration, elapsedSec);
      const tStart = Math.max(0, tEnd - windowDuration);
      const dt = tEnd - tStart;

      const xTicks = [
        { label: `${tStart.toFixed(1)}s`, ratio: 0.0 },
        { label: `${(tStart + dt * 0.25).toFixed(1)}s`, ratio: 0.25 },
        { label: `${(tStart + dt * 0.5).toFixed(1)}s`, ratio: 0.5 },
        { label: `${(tStart + dt * 0.75).toFixed(1)}s`, ratio: 0.75 },
        { label: `${tEnd.toFixed(1)}s`, ratio: 1.0 },
      ];

      ctx.textAlign = "center";
      xTicks.forEach(({ label, ratio }) => {
        const x = padLeft + plotW * ratio;

        ctx.strokeStyle = "rgba(30, 41, 59, 0.6)";
        ctx.beginPath();
        ctx.moveTo(x, padTop);
        ctx.lineTo(x, padTop + plotH);
        ctx.stroke();

        ctx.fillStyle = "rgba(148, 163, 184, 0.7)";
        ctx.fillText(label, x, h - 7);
      });

      // Header Kiri Atas: Sumbu Akselerasi
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(52, 211, 153, 0.9)";
      ctx.font = `700 7.5px ${MONO}`;
      ctx.fillText(`▲ AKSELERASI (±${yLimitAcc.toFixed(1)}g)`, padLeft, 13);

      // Header Kanan Atas: Sumbu Rotasi Gyro
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(251, 191, 36, 0.9)";
      ctx.fillText("ROTASI GYRO ▲", padLeft + plotW, 13);

      // 6. Gambar Gelombang Sinyal Kinematika Nyata
      ctx.save();
      ctx.beginPath();
      ctx.rect(padLeft, padTop, plotW, plotH);
      ctx.clip();

      const stepX = plotW / (maxPoints - 1);

      // Channel 1: Energi Giroskop (Sumbu Y Kanan)
      if (showGyroRef.current) {
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const x = padLeft + i * stepX;
          const normEnergy = Math.max(0.0, Math.min(1.0, pts[i].energy / gyroLimit));
          const y = padTop + plotH - (normEnergy * plotH);

          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = isScanning ? "rgba(245, 158, 11, 0.85)" : "rgba(148, 163, 184, 0.4)";
        ctx.lineWidth = 1.4;
        ctx.setLineDash([3, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Channel 2: Akselerasi Linier Dinamis (Sumbu Y Kiri)
      if (showAccelRef.current) {
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const x = padLeft + i * stepX;
          const normalizedVal = pts[i].val / yLimitAcc;
          const clampedNorm = Math.max(-1.0, Math.min(1.0, normalizedVal));
          const y = plotCy - (clampedNorm * maxPlotAmp);

          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }

        const isActuallyMoving = latestLiveSampleRef.current
          ? Boolean(latestLiveSampleRef.current.isMoving)
          : isZUPTValid;

        const strokeColor = isScanning
          ? isActuallyMoving
            ? "#22C55E" // Hijau neon saat melangkah aktif
            : "#F59E0B" // Oranye saat diam / filter ZUPT aktif
          : "#64748B"; // Abu-abu saat standby

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2.0;
        ctx.shadowColor = strokeColor;
        ctx.shadowBlur = isScanning ? 6 : 0;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Area gradient halus di bawah kurva akselerasi
        ctx.lineTo(padLeft + plotW, plotCy);
        ctx.lineTo(padLeft, plotCy);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
        grad.addColorStop(0, isScanning ? (isActuallyMoving ? "rgba(34, 197, 94, 0.20)" : "rgba(245, 158, 11, 0.14)") : "rgba(100, 116, 139, 0.05)");
        grad.addColorStop(1, "rgba(9, 15, 31, 0)");
        ctx.fillStyle = grad;
        ctx.fill();
      }

      ctx.restore();

      // 7. Label Status Gerak & Nilai Terkini di Dalam Osiloskop (Kiri Bawah)
      if (isScanning && pts.length > 0) {
        const latestPt = pts[pts.length - 1];
        const isMoving = latestPt.isMoving;

        ctx.font = `600 8px ${MONO}`;
        ctx.textAlign = "left";
        ctx.fillStyle = isMoving ? "#4ADE80" : "#FBBF24";
        ctx.fillText(
          isMoving ? "● GERAK AKTIF (Melangkah)" : "○ STATIS / DIAM (ZUPT Terkunci)",
          padLeft + 6,
          padTop + plotH - 6
        );

        ctx.textAlign = "right";
        ctx.fillStyle = "rgba(226, 232, 240, 0.9)";
        ctx.fillText(
          `Acc: ${latestPt.val >= 0 ? "+" : ""}${latestPt.val.toFixed(2)}g · Gyro: ${latestPt.energy.toFixed(2)} (rad/s)²`,
          padLeft + plotW - 6,
          padTop + plotH - 6
        );
      }

      animRef.current = requestAnimationFrame(render);
    }

    animRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animRef.current);
    };
  }, [isScanning, isZUPTValid]);

  return (
    <div
      className="relative rounded-xl overflow-hidden border border-slate-700/60 shadow-inner"
      style={{ background: "#0B1329" }}
    >
      <canvas
        ref={canvasRef}
        width={480}
        height={height}
        className="w-full block"
        style={{ height }}
      />

      {/* Legenda & Kontrol Channel di Bawah Grafik */}
      <div
        className="px-3 py-1.5 bg-slate-950/80 border-t border-slate-900 flex flex-wrap items-center justify-between text-[0.55rem] text-slate-400"
        style={{ fontFamily: MONO }}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowAccel(!showAccel)}
            className="flex items-center gap-1 cursor-pointer hover:text-emerald-300 transition-colors"
          >
            <span
              className="w-2.5 h-0.5 bg-emerald-400 rounded-full"
              style={{ opacity: showAccel ? 1 : 0.3 }}
            />
            Akselerasi (g) [Kiri]
          </button>
          <button
            type="button"
            onClick={() => setShowGyro(!showGyro)}
            className="flex items-center gap-1 cursor-pointer hover:text-amber-300 transition-colors"
          >
            <span
              className="w-2.5 h-0.5 bg-amber-400 rounded-full"
              style={{ opacity: showGyro ? 1 : 0.3 }}
            />
            Rotasi Gyro (rad/s)² [Kanan]
          </button>
        </div>
        <span className="text-slate-500">
          20 HZ · REAL-TIME BLE
        </span>
      </div>
    </div>
  );
}
