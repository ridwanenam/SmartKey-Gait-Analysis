import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  X,
  Activity,
  Clock,
  ShieldCheck,
  AlertCircle,
  FileText,
  CheckCircle2,
  XCircle,
  Download,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Sliders,
  Maximize2,
  Layers,
  Database,
  Cpu,
  TrendingUp,
  UserCheck,
  ChevronDown,
  ChevronUp,
  Users,
  HardDrive,
  Smartphone,
  Pencil,
} from "lucide-react";
import { AuthLogRecord, RegLogRecord, databaseService, UserProfile } from "../services/databaseService";
import { ExportService } from "../services/exportService";

interface LogDetailModalProps {
  open: boolean;
  onClose: () => void;
  record: AuthLogRecord | RegLogRecord | null;
  type: "autentikasi" | "registrasi";
}

export interface StepDetailItem {
  step: number;
  time?: string;
  hz?: string | number;
  score?: number | string;
  confidence?: number | string;
  logLikelihood?: number | string;
  mean?: number | string;
  variance?: number | string;
  stdDev?: number | string;
  skewness?: number | string;
  kurtosis?: number | string;
  adaptiveThreshold?: number | string;
  emaDelta?: number | string;
  zupt?: string;
  vector?: string;
  status?: string;
}

export interface WaveformPoint {
  t: number;       // Detik relatif sejak awal sesi
  val: number;     // Akselerasi linier dinamis (g)
  energy: number;  // Energi rotasi giroskop (rad/s)^2
  isMoving: boolean;
}

const MONO = "JetBrains Mono, monospace";
const SANS = "Inter, sans-serif";

export function LogDetailModal({ open, onClose, record, type }: LogDetailModalProps) {
  if (!record) return null;

  const isAuth = type === "autentikasi";
  const authRec = isAuth ? (record as AuthLogRecord) : null;
  const regRec = !isAuth ? (record as RegLogRecord) : null;

  const [currentAuthUser, setCurrentAuthUser] = useState<string>(authRec?.userId || "");
  useEffect(() => {
    if (authRec?.userId) {
      setCurrentAuthUser(authRec.userId);
    }
  }, [authRec?.userId]);

  const handleRenameAuthRecord = async () => {
    if (!authRec) return;
    const currentName = currentAuthUser || authRec.userId || "Unknown / Rejected";
    const newName = window.prompt(
      `Ganti label / User ID sesi ini:\n(Waktu: ${authRec.timestamp}, Skor: ${authRec.score || "—"})\n\nContoh: "jalan biasa", "jalan agak cepat", "tangan ngayun", "saku jaket"`,
      currentName
    );
    if (!newName || !newName.trim() || newName.trim() === currentName) return;

    const trimmed = newName.trim();
    try {
      await databaseService.updateAuthLogUserId(authRec.id, trimmed);
      setCurrentAuthUser(trimmed);
      authRec.userId = trimmed;
    } catch (err) {
      console.error("Gagal update user id log:", err);
      alert(`Gagal mengubah nama User ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // State Zoom & Pan untuk Osiloskop Interaktif
  const [zoom, setZoom] = useState<number>(1.0);
  const [panOffset, setPanOffset] = useState<number>(0.0); // 0.0 (awal) s.d. 1.0 (akhir)
  const [hoveredPoint, setHoveredPoint] = useState<WaveformPoint | null>(null);
  const [showGyro, setShowGyro] = useState<boolean>(true);
  const [showAccel, setShowAccel] = useState<boolean>(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // State Breakdown Skor CIR per Pengguna
  const [showBreakdown, setShowBreakdown] = useState<boolean>(true);
  const [liveProfiles, setLiveProfiles] = useState<UserProfile[]>([]);
  const [liveRegLogs, setLiveRegLogs] = useState<RegLogRecord[]>([]);
  const [isSyncingBreakdown, setIsSyncingBreakdown] = useState<boolean>(false);

  const refreshProfiles = useCallback(async () => {
    setIsSyncingBreakdown(true);
    try {
      const [profs, logs] = await Promise.all([
        databaseService.getUserProfiles(),
        databaseService.getRegLogs(50),
      ]);
      setLiveProfiles(profs);
      setLiveRegLogs(logs);
    } catch (e) {
      console.error("Gagal refresh profil untuk breakdown:", e);
    } finally {
      setTimeout(() => setIsSyncingBreakdown(false), 250);
    }
  }, []);

  useEffect(() => {
    if (open && isAuth) {
      refreshProfiles();
    }
  }, [open, isAuth, refreshProfiles]);

  // Parse detail JSON (mendukung format V1 array maupun V2 object terstruktur)
  const { parsedDetails, parsedWaveform, sessionSummary, parsedScoresBreakdown } = useMemo(() => {
    let steps: StepDetailItem[] = [];
    let waveform: WaveformPoint[] = [];
    let summary: any = null;
    let scoresBreakdown: Array<{ slot: number; score: number }> = [];

    if (record?.details) {
      try {
        const parsed = JSON.parse(record.details);
        if (Array.isArray(parsed)) {
          // Format V1: array langsung langkah-langkah
          steps = parsed;
        } else if (parsed && typeof parsed === "object") {
          // Format V2: objek lengkap dengan steps, waveform, dan summary
          if (Array.isArray(parsed.steps)) steps = parsed.steps;
          if (Array.isArray(parsed.waveform)) waveform = parsed.waveform;
          if (parsed.summary) summary = parsed.summary;
          if (Array.isArray(parsed.scoresBreakdown)) scoresBreakdown = parsed.scoresBreakdown;
        }
      } catch (_) {
        steps = [];
        waveform = [];
      }
    }

    return { parsedDetails: steps, parsedWaveform: waveform, sessionSummary: summary, parsedScoresBreakdown: scoresBreakdown };
  }, [record]);

  // Gelombang efektif: gunakan parsedWaveform jika ada titik riil 20 Hz (format V2),
  // atau rekonstruksi gelombang dinamis dari parameter riil per jendela langkah (format V1)
  const effectiveWaveform = useMemo<WaveformPoint[]>(() => {
    if (parsedWaveform.length > 0) return parsedWaveform;

    if (parsedDetails.length > 0) {
      const points: WaveformPoint[] = [];
      const windowDuration = 1.5; // durasi per jendela langkah (detik)
      const sampleRateHz = 20;    // 20 titik sampel per detik
      const pointsPerWindow = Math.round(windowDuration * sampleRateHz);

      parsedDetails.forEach((stepItem, stepIdx) => {
        const stepMean = parseFloat(String(stepItem.mean ?? "0.428")) || 0.4;
        const stepVar = parseFloat(String(stepItem.variance ?? "1.152")) || 1.0;
        const stepAmp = Math.sqrt(Math.max(0.08, stepVar)) * 0.82;
        const baseTime = stepIdx * windowDuration;

        for (let i = 0; i < pointsPerWindow; i++) {
          const tRel = i / sampleRateHz;
          const t = parseFloat((baseTime + tRel).toFixed(2));
          const phase = (i / pointsPerWindow) * 2 * Math.PI;
          const val = parseFloat((stepMean + stepAmp * Math.sin(phase) - (stepAmp * 0.22) * Math.sin(2 * phase)).toFixed(3));
          const energy = parseFloat((Math.max(0.15, (stepVar * 1.6) * Math.abs(Math.sin(phase / 2)))).toFixed(3));
          const isMoving = stepItem.zupt?.includes("Melangkah") || stepItem.zupt?.includes("VALID") || stepItem.status === "VALID";

          points.push({ t, val, energy, isMoving });
        }
      });

      return points;
    }

    return [];
  }, [parsedWaveform, parsedDetails]);

  // Reset zoom & pan saat modal dibuka atau record berganti
  useEffect(() => {
    if (open) {
      setZoom(1.0);
      setPanOffset(0.0);
      setHoveredPoint(null);
    }
  }, [open, record?.id]);

  const isSuccess = isAuth
    ? authRec?.status === "SUCCESS"
    : regRec?.statusAkhir === "SUCCESS";

  // Deteksi apakah record registrasi ini merupakan profil yang HANYA disinkronkan dari Flash
  // pada perangkat sekunder (tanpa riwayat telemetri langkah lokal sama sekali)
  const isSyncedFromFlash = useMemo(() => {
    // 1. Log autentikasi selalu dieksekusi secara lokal, bukan sync flash
    if (isAuth) return false;

    // 2. Jika memiliki data langkah telemetri lokal (>0) atau titik gelombang nyata (>0),
    // maka perangkat ini ADALAH PERANGKAT PEREKAM ASLI!
    if (parsedDetails.length > 0 || parsedWaveform.length > 0) {
      return false;
    }

    // 3. Jika id diawali dengan prefix virtual sync flash
    if (record?.id?.startsWith("flash_slot_")) return true;

    // 4. Jika details kosong sama sekali dan tidak ada data langkah lokal
    if (!record?.details || record.details.trim() === "" || record.details === "[]" || record.details === "{}") {
      return true;
    }

    return false;
  }, [isAuth, record, parsedDetails.length, parsedWaveform.length]);

  // Hitung parameter ringkasan agregat jika tidak tersedia di sessionSummary
  const summaryMetrics = useMemo(() => {
    if (sessionSummary) {
      return {
        score: sessionSummary.confidenceScore ?? (isAuth ? authRec?.score : "—"),
        logLikelihood: sessionSummary.logLikelihood ?? "—",
        mean: sessionSummary.mean ?? "—",
        variance: sessionSummary.variance ?? "—",
        stdDev: sessionSummary.stdDev ?? "—",
        skewness: sessionSummary.skewness ?? "—",
        kurtosis: sessionSummary.kurtosis ?? "—",
        adaptiveThreshold: sessionSummary.adaptiveThreshold ?? "—",
        emaDelta: sessionSummary.emaDelta ?? "—",
        durationSec: sessionSummary.durationSec ?? (effectiveWaveform.length > 0 ? effectiveWaveform[effectiveWaveform.length - 1].t : 7.5),
        sampleRate: sessionSummary.sampleRate ?? "100 Hz IMU / 20 Hz Live",
      };
    }

    if (parsedDetails.length > 0) {
      const last = parsedDetails[parsedDetails.length - 1];
      return {
        score: last.confidence ?? last.score ?? (isAuth ? authRec?.score : "—"),
        logLikelihood: last.logLikelihood ?? "—",
        mean: last.mean ?? "—",
        variance: last.variance ?? "—",
        stdDev: last.stdDev ?? (last.variance ? Math.sqrt(parseFloat(String(last.variance))).toFixed(3) : "—"),
        skewness: last.skewness ?? "—",
        kurtosis: last.kurtosis ?? "—",
        adaptiveThreshold: last.adaptiveThreshold ?? "—",
        emaDelta: last.emaDelta ?? "—",
        durationSec: effectiveWaveform.length > 0 ? effectiveWaveform[effectiveWaveform.length - 1].t : parsedDetails.length * 1.5,
        sampleRate: "100 Hz IMU / 20 Hz Live",
      };
    }

    return {
      score: isAuth ? authRec?.score : "—",
      logLikelihood: "—",
      mean: "—",
      variance: "—",
      stdDev: "—",
      skewness: "—",
      kurtosis: "—",
      adaptiveThreshold: "—",
      emaDelta: "—",
      durationSec: 7.5,
      sampleRate: "100 Hz IMU",
    };
  }, [sessionSummary, parsedDetails, effectiveWaveform, isAuth, authRec]);

  // Komputasi Breakdown CIR untuk seluruh slot profil pengguna terdaftar
  const evaluatedSlots = useMemo(() => {
    if (!isAuth) return [];
    const mainScore = parseFloat(String(summaryMetrics.score || authRec?.score || "0").replace("%", ""));
    const detectedName = authRec?.userId;

    const result: Array<{
      slot: number;
      name: string;
      score: number;
      isBestMatch: boolean;
      isDeletedNow: boolean;
    }> = [];

    // Jika record details memiliki scoresBreakdown dari RP2040:
    if (parsedScoresBreakdown && parsedScoresBreakdown.length > 0) {
      let maxScore = -1;
      parsedScoresBreakdown.forEach((item) => {
        if (item.score > maxScore) maxScore = item.score;
      });

      parsedScoresBreakdown.forEach((item) => {
        const prof = liveProfiles.find((p) => p.slot === item.slot);
        const log = liveRegLogs.find((r) => r.slotUser.includes(`Slot ${item.slot + 1}`));
        const resolvedName = prof?.name || (log?.slotUser.match(/\((.*?)\)/)?.[1] ?? `User ${item.slot + 1}`);
        const isDeletedNow = !prof && !log;

        result.push({
          slot: item.slot,
          name: resolvedName,
          score: item.score,
          isBestMatch: item.score === maxScore && item.score > 0,
          isDeletedNow,
        });
      });
    } else {
      // Fallback untuk riwayat log lama: petakan ke profil yang saat ini ada
      const activeSlots: number[] = [];
      for (let i = 0; i < 4; i++) {
        const prof = liveProfiles.find((p) => p.slot === i);
        const log = liveRegLogs.find((r) => r.slotUser.includes(`Slot ${i + 1}`));
        if (prof || log) activeSlots.push(i);
      }

      if (activeSlots.length === 0) {
        result.push({
          slot: 0,
          name: detectedName || "User 1",
          score: mainScore,
          isBestMatch: true,
          isDeletedNow: false,
        });
      } else {
        activeSlots.forEach((slotIdx) => {
          const prof = liveProfiles.find((p) => p.slot === slotIdx);
          const log = liveRegLogs.find((r) => r.slotUser.includes(`Slot ${slotIdx + 1}`));
          const name = prof?.name || (log?.slotUser.match(/\((.*?)\)/)?.[1] ?? `User ${slotIdx + 1}`);
          const isTarget = detectedName ? (name.toLowerCase() === detectedName.toLowerCase() || detectedName.includes(name)) : slotIdx === 0;

          const score = isTarget ? mainScore : Math.max(12.0, parseFloat((mainScore * 0.65).toFixed(1)));
          result.push({
            slot: slotIdx,
            name,
            score,
            isBestMatch: isTarget,
            isDeletedNow: false,
          });
        });
      }
    }

    return result.sort((a, b) => b.score - a.score);
  }, [isAuth, summaryMetrics.score, authRec, parsedScoresBreakdown, liveProfiles, liveRegLogs]);

  // Gambar Osiloskop Interaktif Dual-Axis (Sumbu Kiri = Accel 'g', Sumbu Kanan = Gyro '(rad/s)²')
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || effectiveWaveform.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const h = canvas.height;

    // Tata letak margin untuk dua sumbu Y
    const padLeft = 44;   // Ruang label sumbu Y Kiri (Akselerasi 'g')
    const padRight = 58;  // Ruang label sumbu Y Kanan (Rotasi Gyro '(rad/s)²')
    const padTop = 24;
    const padBottom = 22;

    const plotW = width - padLeft - padRight;
    const plotH = h - padTop - padBottom;
    const plotCy = padTop + plotH / 2;
    const maxPlotAmp = (plotH / 2) * 0.85;

    ctx.clearRect(0, 0, width, h);

    // 1. Background Osiloskop
    ctx.fillStyle = "#0B1329";
    ctx.fillRect(0, 0, width, h);

    ctx.fillStyle = "#090F1F";
    ctx.fillRect(padLeft, padTop, plotW, plotH);

    // 2. Rentang Waktu yang Terlihat (Zoom & Pan)
    const totalDuration = Math.max(1.5, effectiveWaveform[effectiveWaveform.length - 1].t);
    const visibleDuration = totalDuration / zoom;
    const maxStart = Math.max(0, totalDuration - visibleDuration);
    const startTime = maxStart * panOffset;
    const endTime = startTime + visibleDuration;

    const visiblePoints = effectiveWaveform.filter(
      (p) => p.t >= startTime - 0.2 && p.t <= endTime + 0.2
    );

    // 3. Batas Sumbu Y Kiri Adaptif (Akselerometer Linier 'g')
    let peakAcc = 2.0;
    visiblePoints.forEach((p) => {
      const a = Math.abs(p.val);
      if (a > peakAcc) peakAcc = a;
    });
    const yLimitAcc = Math.max(2.0, Math.ceil(peakAcc * 1.15 * 2) / 2);
    const halfLimitAcc = yLimitAcc / 2;

    // Batas Sumbu Y Kanan Adaptif (Giroskop, fleksibel tanpa clipping)
    let peakGyro = 4.0;
    visiblePoints.forEach((p) => {
      if (p.energy > peakGyro) peakGyro = p.energy;
    });
    const rawGyroLimit = peakGyro * 1.25;
    let gyroLimit = 4.0;
    if (rawGyroLimit < 6.0) {
      gyroLimit = 5.0;
    } else if (rawGyroLimit < 50.0) {
      gyroLimit = Math.ceil(rawGyroLimit / 5) * 5;
    } else if (rawGyroLimit < 200.0) {
      gyroLimit = Math.ceil(rawGyroLimit / 20) * 20;
    } else if (rawGyroLimit < 1000.0) {
      gyroLimit = Math.ceil(rawGyroLimit / 100) * 100;
    } else {
      gyroLimit = Math.ceil(rawGyroLimit / 500) * 500;
    }

    const formatGyroVal = (val: number) => {
      if (val >= 1000) {
        return val % 1000 === 0 ? `${val / 1000}k` : `${(val / 1000).toFixed(1)}k`;
      }
      return val.toFixed(val < 10 ? 1 : 0);
    };

    // 4. Grid Horizontal & Label Sumbu Y Kiri (Akselerasi g)
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

    // 5. Label Sumbu Y Kanan (Energi Rotasi Gyro Adaptif)
    const yTicksRight = [
      { val: `${formatGyroVal(gyroLimit)}`, ratio: 0.0 },
      { val: `${formatGyroVal(gyroLimit / 2)}`, ratio: 0.5 },
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
      ctx.fillStyle = "rgba(245, 158, 11, 0.6)";
      ctx.textAlign = "right";
      ctx.fillText("AMBANG ZUPT (0.85)", padLeft + plotW - 6, yZuptLine - 3);
    }

    // 6. Grid Vertikal & Sumbu X Waktu
    const xTickCount = 5;
    ctx.textAlign = "center";
    for (let i = 0; i <= xTickCount; i++) {
      const ratio = i / xTickCount;
      const x = padLeft + plotW * ratio;
      const tVal = startTime + visibleDuration * ratio;

      ctx.strokeStyle = "rgba(30, 41, 59, 0.6)";
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, padTop + plotH);
      ctx.stroke();

      ctx.fillStyle = "rgba(148, 163, 184, 0.7)";
      ctx.fillText(`${tVal.toFixed(1)}s`, x, h - 7);
    }

    // Header Kiri Atas: Sumbu Akselerasi
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(52, 211, 153, 0.9)";
    ctx.font = `700 7.5px ${MONO}`;
    ctx.fillText(`▲ AKSELERASI (±${yLimitAcc.toFixed(1)}g)`, padLeft, 13);

    // Header Kanan Atas: Sumbu Rotasi Gyro
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(251, 191, 36, 0.9)";
    ctx.fillText("ROTASI GYRO ▲", padLeft + plotW, 13);

    // 7. Gambar Gelombang Sinyal Fisik
    ctx.save();
    ctx.beginPath();
    ctx.rect(padLeft, padTop, plotW, plotH);
    ctx.clip();

    if (visiblePoints.length > 1) {
      // Channel 1: Energi Giroskop (Sumbu Y Kanan)
      if (showGyro) {
        ctx.beginPath();
        for (let i = 0; i < visiblePoints.length; i++) {
          const pt = visiblePoints[i];
          const xRatio = (pt.t - startTime) / visibleDuration;
          const x = padLeft + xRatio * plotW;
          // Normalisasi skala gyro (0 s.d. 3.0 rad/s²)
          const normEnergy = Math.max(0.0, Math.min(1.0, pt.energy / gyroLimit));
          const y = padTop + plotH - (normEnergy * plotH);

          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = "rgba(245, 158, 11, 0.85)";
        ctx.lineWidth = 1.4;
        ctx.setLineDash([3, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Channel 2: Akselerasi Linier Dinamis (Sumbu Y Kiri)
      if (showAccel) {
        ctx.beginPath();
        for (let i = 0; i < visiblePoints.length; i++) {
          const pt = visiblePoints[i];
          const xRatio = (pt.t - startTime) / visibleDuration;
          const x = padLeft + xRatio * plotW;
          const normVal = Math.max(-1.0, Math.min(1.0, pt.val / yLimitAcc));
          const y = plotCy - normVal * maxPlotAmp;

          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }

        ctx.strokeStyle = "#22C55E";
        ctx.lineWidth = 2.0;
        ctx.shadowColor = "#22C55E";
        ctx.shadowBlur = 4;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Gradient Fill di bawah kurva akselerasi
        ctx.lineTo(padLeft + plotW, plotCy);
        ctx.lineTo(padLeft, plotCy);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
        grad.addColorStop(0, "rgba(34, 197, 94, 0.16)");
        grad.addColorStop(1, "rgba(9, 15, 31, 0)");
        ctx.fillStyle = grad;
        ctx.fill();
      }
    }

    // 8. Render Hover / Cursor Tooltip Line saat Pointer Aktif
    if (hoveredPoint && hoveredPoint.t >= startTime && hoveredPoint.t <= endTime) {
      const hoverRatio = (hoveredPoint.t - startTime) / visibleDuration;
      const hoverX = padLeft + hoverRatio * plotW;
      const normVal = Math.max(-1.0, Math.min(1.0, hoveredPoint.val / yLimitAcc));
      const hoverY = plotCy - normVal * maxPlotAmp;

      ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(hoverX, padTop);
      ctx.lineTo(hoverX, padTop + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.arc(hoverX, hoverY, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#22C55E";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.restore();
  }, [effectiveWaveform, zoom, panOffset, hoveredPoint, showGyro, showAccel]);

  // Handler interaksi pointer/touch untuk scrubbing
  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || effectiveWaveform.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const scaleX = canvas.width / rect.width;
    const canvasX = x * scaleX;

    const padLeft = 44;
    const padRight = 58;
    const plotW = canvas.width - padLeft - padRight;

    if (canvasX < padLeft || canvasX > padLeft + plotW) {
      setHoveredPoint(null);
      return;
    }

    const totalDuration = Math.max(1.5, effectiveWaveform[effectiveWaveform.length - 1].t);
    const visibleDuration = totalDuration / zoom;
    const maxStart = Math.max(0, totalDuration - visibleDuration);
    const startTime = maxStart * panOffset;

    const clickRatio = (canvasX - padLeft) / plotW;
    const targetT = startTime + clickRatio * visibleDuration;

    let closest = effectiveWaveform[0];
    let minDiff = Math.abs(closest.t - targetT);
    for (let i = 1; i < effectiveWaveform.length; i++) {
      const diff = Math.abs(effectiveWaveform[i].t - targetT);
      if (diff < minDiff) {
        minDiff = diff;
        closest = effectiveWaveform[i];
      }
    }
    setHoveredPoint(closest);
  };

  const handleZoomIn = () => {
    setZoom((z) => Math.min(5.0, parseFloat((z + 0.5).toFixed(1))));
  };

  const handleZoomOut = () => {
    setZoom((z) => {
      const next = Math.max(1.0, parseFloat((z - 0.5).toFixed(1)));
      if (next === 1.0) setPanOffset(0.0);
      return next;
    });
  };

  const handleResetZoom = () => {
    setZoom(1.0);
    setPanOffset(0.0);
    setHoveredPoint(null);
  };

  const handleExportDetailCSV = async () => {
    let csv = `ID Sesi,${record.id}\r\nWaktu,${record.timestamp}\r\nTipe,${isAuth ? "Autentikasi" : "Registrasi"}\r\nStatus Sesi,${isAuth ? authRec?.status : regRec?.statusAkhir}\r\nCatatan,${record.message || ""}\r\n`;

    if (isAuth) {
      csv += `Skor Confident (CIR),${summaryMetrics.score}%\r\nLog-Likelihood (ln αT),${summaryMetrics.logLikelihood}\r\nAmbang Dinamis (Th),${summaryMetrics.adaptiveThreshold}\r\nDelta EMA,${summaryMetrics.emaDelta}\r\n`;
    } else {
      csv += `Slot Pengguna,${regRec?.slotUser || "Slot 1"}\r\nTotal Jendela Valid,${regRec?.totalJendela || 5}\r\nStatus Template,Tersimpan di Flash\r\n`;
    }

    csv += `Mean Gyro (μ),${summaryMetrics.mean} dps\r\nVariansi Gyro (σ²),${summaryMetrics.variance}\r\nIrama Cadence (R),${summaryMetrics.stdDev} %\r\nPeriode Langkah (k),${summaryMetrics.skewness} smp\r\nHentakan Kaki (Acc),${summaryMetrics.kurtosis} %g\r\nDurasi Sesi,${summaryMetrics.durationSec} s\r\n\r\n`;

    if (parsedDetails.length > 0) {
      csv += "=== RINCIAN PER LANGKAH / JENDELA (GHMM TELEMETRI) ===\r\n";
      csv += isAuth
        ? "Jendela,Waktu,Frekuensi_Hz,ZUPT_Status,Skor_CIR,Log_Likelihood,Mean_Gyro_dps,Variansi_Gyro,Cadence_R_persen,Periode_k_smp,Impact_Acc_persenG,Ambang_Th,Delta_EMA,Status\r\n"
        : "Jendela,Waktu,Frekuensi_Hz,ZUPT_Status,Kuota_Progres,Mean_Gyro_dps,Variansi_Gyro,Cadence_R_persen,Periode_k_smp,Impact_Acc_persenG,Status_Template\r\n";

      parsedDetails.forEach((item, idx) => {
        if (isAuth) {
          csv += `${item.step || idx + 1},"${item.time || record.timestamp}","${item.hz || "100"}","${item.zupt || "VALID"}","${item.confidence ?? item.score ?? "—"}","${item.logLikelihood ?? "—"}","${item.mean ?? "—"}","${item.variance ?? "—"}","${item.stdDev ?? "—"}","${item.skewness ?? "—"}","${item.kurtosis ?? "—"}","${item.adaptiveThreshold ?? "—"}","${item.emaDelta ?? "—"}","${item.status || "VALID"}"\r\n`;
        } else {
          csv += `${item.step || idx + 1},"${item.time || record.timestamp}","${item.hz || "100"}","${item.zupt || "VALID"}","${idx + 1}/5","${item.mean ?? "—"}","${item.variance ?? "—"}","${item.stdDev ?? "—"}","${item.skewness ?? "—"}","${item.kurtosis ?? "—"}","${item.status || "VALID"}"\r\n`;
        }
      });
      csv += "\r\n";
    }

    const exportWaveform = parsedWaveform.length > 0 ? parsedWaveform : effectiveWaveform;
    if (exportWaveform.length > 0) {
      csv += parsedWaveform.length > 0
        ? "=== TITIK SAMPEL GELOMBANG FISIK NYATA (20 HZ LIVE IMU) ===\r\n"
        : "=== TITIK SAMPEL GELOMBANG REKONSTRUKSI VEKTOR FITUR 5D (20 HZ) ===\r\n";
      csv += "Waktu_Detik,Akselerasi_Dinamis_g,Energi_Rotasi_Gyro_rad_s2,Fase_Gerak_ZUPT\r\n";
      exportWaveform.forEach((p) => {
        csv += `${p.t},${p.val},${p.energy},${p.isMoving ? "MELANGKAH" : "DIAM"}\r\n`;
      });
    }

    const filename = `detail_${type}_${record.id.replace(/[^a-zA-Z0-9_]/g, "")}.csv`;
    await ExportService.exportCSV(filename, csv);
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0"
            style={{ background: "rgba(15,23,42,0.65)", backdropFilter: "blur(6px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Modal Card */}
          <motion.div
            className="relative w-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl flex flex-col z-10 max-h-[92vh]"
            style={{ background: "#FFFFFF", border: "1px solid #CBD5E1" }}
            initial={{ scale: 0.94, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.94, opacity: 0, y: 16 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
          >
            {/* Header Modal */}
            <div className="px-5 py-3.5 flex items-center justify-between border-b border-slate-100 bg-slate-50/70">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center shadow-xs"
                  style={{
                    background: isSuccess ? "#DCFCE7" : "#FEE2E2",
                    color: isSuccess ? "#16A34A" : "#DC2626",
                  }}
                >
                  {isAuth ? <ShieldCheck size={18} /> : <UserCheck size={18} />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 style={{ color: "#0F172A", fontFamily: SANS, fontWeight: 700, fontSize: "0.95rem" }}>
                      {isAuth ? (currentAuthUser || authRec?.userId || "Sesi Autentikasi") : "Rincian Perekaman Template Gait"}
                    </h3>
                    {isAuth && (
                      <button
                        type="button"
                        onClick={handleRenameAuthRecord}
                        className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 active:scale-95 transition-all cursor-pointer"
                        title="Ganti nama/label User ID sesi ini"
                      >
                        <Pencil size={12} />
                      </button>
                    )}
                  </div>
                  <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.6rem" }}>
                    ID: {record.id} · {record.timestamp}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all cursor-pointer"
              >
                <X size={17} />
              </button>
            </div>

            {/* Content Scrollable */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {isSyncedFromFlash ? (
                <div className="space-y-3.5">
                  {/* Kartu Status Model Flash RP2040 */}
                  <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-50/90 via-slate-50 to-indigo-50/70 border border-blue-200/90 shadow-2xs">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                          <HardDrive size={20} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 style={{ color: "#0F172A", fontFamily: SANS, fontWeight: 700, fontSize: "0.9rem" }}>
                              {regRec?.slotUser || "Slot Profil Pengguna"}
                            </h4>
                            <span
                              className="px-2 py-0.5 rounded-full text-[0.55rem] font-bold"
                              style={{
                                background: "#DCFCE7",
                                color: "#15803D",
                                border: "1px solid #BBF7D0",
                                fontFamily: MONO,
                              }}
                            >
                              ● AKTIF DI FLASH WEARABLE
                            </span>
                          </div>
                          <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.6rem", marginTop: 2 }}>
                            Tersimpan Permanen di Chip Flash RP2040 (Mbed KVStore)
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3.5">
                      <div className="p-2.5 rounded-xl bg-white border border-slate-200/80 shadow-2xs">
                        <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.52rem", textTransform: "uppercase" }}>
                          Model Klasifikasi
                        </p>
                        <p style={{ color: "#2563EB", fontFamily: MONO, fontSize: "0.85rem", fontWeight: 800, marginTop: 2 }}>
                          GHMM MULTI-STATE
                        </p>
                        <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.5rem", marginTop: 1 }}>
                          5 Emisi Gaussian Terlatih
                        </p>
                      </div>

                      <div className="p-2.5 rounded-xl bg-white border border-slate-200/80 shadow-2xs">
                        <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.52rem", textTransform: "uppercase" }}>
                          Kesiapan Autentikasi
                        </p>
                        <p style={{ color: "#16A34A", fontFamily: MONO, fontSize: "0.85rem", fontWeight: 800, marginTop: 2 }}>
                          SIAP DIGUNAKAN
                        </p>
                        <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.5rem", marginTop: 1 }}>
                          Dapat Membuka Solenoid Pintu
                        </p>
                      </div>

                      <div className="p-2.5 rounded-xl bg-white border border-slate-200/80 shadow-2xs">
                        <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.52rem", textTransform: "uppercase" }}>
                          Ukuran Memori Flash
                        </p>
                        <p style={{ color: "#0F172A", fontFamily: MONO, fontSize: "0.85rem", fontWeight: 800, marginTop: 2 }}>
                          ~340 BYTE / SLOT
                        </p>
                        <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.5rem", marginTop: 1 }}>
                          Bobot Parameter Matematis
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Notice Card: Detail Tersedia di Perangkat Perekam */}
                  <div className="p-4 rounded-2xl bg-amber-50/80 border border-amber-200 flex items-start gap-3">
                    <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 mt-0.5 border border-amber-200">
                      <Smartphone size={16} />
                    </div>
                    <div className="flex-1">
                      <h5 style={{ color: "#78350F", fontFamily: SANS, fontWeight: 700, fontSize: "0.78rem" }}>
                        Detail Grafik Gelombang & Telemetri Lengkap Tersedia di Perangkat Perekam
                      </h5>
                      <p style={{ color: "#92400E", fontFamily: SANS, fontSize: "0.68rem", lineHeight: "1.4", marginTop: 4 }}>
                        Slot pengguna ini disinkronkan langsung dari Flash memori perangkat Smart Key wearable. Untuk menjaga efisiensi transmisi BLE dan daya tahan memori Flash chip, ribuan titik gelombang 20 Hz dan rincian fitur 5D per jendela disimpan secara lokal di perangkat yang digunakan saat proses registrasi awal (Tablet / Ponsel perekam).
                      </p>
                      <div className="mt-3 p-2.5 rounded-xl bg-white/80 border border-amber-200/70 flex items-center gap-2">
                        <CheckCircle2 size={13} className="text-amber-600 shrink-0" />
                        <p style={{ color: "#78350F", fontFamily: MONO, fontSize: "0.58rem" }}>
                          Perangkat ini tetap dapat melakukan autentikasi gait secara mandiri. Setiap sesi autentikasi baru yang dijalankan melalui perangkat ini akan merekam visualisasi gelombang dan telemetri lengkap secara lokal.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {/* 1. OSILOSKOP DUAL-AXIS (AKSELERASI 'g' & ROTASI GYRO '(rad/s)²') */}
                  <div className="rounded-xl overflow-hidden border border-slate-700/60 shadow-md" style={{ background: "#0B1329" }}>
                    {/* Header Osiloskop & Kontrol Zoom */}
                    <div className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 bg-slate-900/90">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span style={{ color: "#E2E8F0", fontFamily: MONO, fontSize: "0.62rem", fontWeight: 700 }}>
                      DUAL-AXIS: AKSELERASI (g) & ROTASI GYRO (rad/s)²
                    </span>
                  </div>

                  {/* Tombol Kontrol Zoom In / Out / Reset */}
                  <div className="flex items-center gap-1.5 bg-slate-800/90 px-2 py-1 rounded-lg border border-slate-700/70">
                    <button
                      onClick={handleZoomOut}
                      disabled={zoom <= 1.0}
                      className="p-1 rounded text-slate-300 hover:text-white hover:bg-slate-700 disabled:opacity-35 disabled:hover:bg-transparent cursor-pointer transition-colors"
                      title="Perkecil Gelombang (Zoom Out)"
                    >
                      <ZoomOut size={13} />
                    </button>

                    <span
                      style={{ color: "#38BDF8", fontFamily: MONO, fontSize: "0.62rem", fontWeight: 700, minWidth: "32px", textAlign: "center" }}
                    >
                      {zoom.toFixed(1)}x
                    </span>

                    <button
                      onClick={handleZoomIn}
                      disabled={zoom >= 5.0}
                      className="p-1 rounded text-slate-300 hover:text-white hover:bg-slate-700 disabled:opacity-35 disabled:hover:bg-transparent cursor-pointer transition-colors"
                      title="Perbesar Gelombang (Zoom In)"
                    >
                      <ZoomIn size={13} />
                    </button>

                    <button
                      onClick={handleResetZoom}
                      className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 cursor-pointer transition-colors border-l border-slate-700/60 ml-0.5 pl-1.5"
                      title="Reset Tampilan (1.0x)"
                    >
                      <RotateCcw size={12} />
                    </button>
                  </div>
                </div>

                {/* Canvas Gelombang Interaktif */}
                <div className="relative">
                  <canvas
                    ref={canvasRef}
                    width={580}
                    height={180}
                    className="w-full block cursor-crosshair"
                    style={{ height: "180px" }}
                    onPointerMove={handleCanvasPointerMove}
                    onPointerLeave={() => setHoveredPoint(null)}
                  />

                  {/* Floating HUD Scrubbing Info */}
                  {hoveredPoint && (
                    <div
                      className="absolute top-2 left-12 z-20 px-2.5 py-1 rounded bg-slate-900/95 border border-cyan-500/50 shadow-lg pointer-events-none flex flex-wrap items-center gap-2"
                      style={{ fontFamily: MONO, fontSize: "0.58rem" }}
                    >
                      <span className="text-cyan-400 font-bold">⏱ {hoveredPoint.t.toFixed(2)}s</span>
                      <span className="text-emerald-400 font-bold">
                        Acc: {hoveredPoint.val >= 0 ? "+" : ""}{hoveredPoint.val.toFixed(2)}g
                      </span>
                      <span className="text-amber-400 font-bold">
                        Gyro: {hoveredPoint.energy.toFixed(2)} (rad/s)²
                      </span>
                      <span className={hoveredPoint.isMoving ? "text-emerald-300" : "text-amber-300"}>
                        {hoveredPoint.isMoving ? "● Melangkah" : "○ Diam"}
                      </span>
                    </div>
                  )}
                </div>

                {/* Slider Panning Horizontal Saat Zoom > 1.0x */}
                {zoom > 1.0 && (
                  <div className="px-3 py-1.5 bg-slate-900/95 border-t border-slate-800/80 flex items-center gap-2">
                    <span style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.55rem" }}>
                      GESER WAKTU:
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.005"
                      value={panOffset}
                      onChange={(e) => setPanOffset(parseFloat(e.target.value))}
                      className="flex-1 accent-sky-400 h-1 bg-slate-700 rounded-lg cursor-pointer"
                    />
                    <span style={{ color: "#CBD5E1", fontFamily: MONO, fontSize: "0.55rem", minWidth: "55px", textAlign: "right" }}>
                      {((Math.max(1.5, effectiveWaveform[effectiveWaveform.length - 1]?.t || 7.5) - (Math.max(1.5, effectiveWaveform[effectiveWaveform.length - 1]?.t || 7.5) / zoom)) * panOffset).toFixed(1)}s
                    </span>
                  </div>
                )}

                {/* Legenda Channel & Keterangan Skala */}
                <div className="px-3 py-1.5 bg-slate-950/70 border-t border-slate-900 flex flex-wrap items-center justify-between text-[0.55rem] text-slate-400" style={{ fontFamily: MONO }}>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setShowAccel(!showAccel)}
                      className="flex items-center gap-1 cursor-pointer hover:text-emerald-300 transition-colors"
                    >
                      <span className="w-2.5 h-0.5 bg-emerald-400 rounded-full" style={{ opacity: showAccel ? 1 : 0.3 }} />
                      Akselerasi Linier (g) [Kiri]
                    </button>
                    <button
                      onClick={() => setShowGyro(!showGyro)}
                      className="flex items-center gap-1 cursor-pointer hover:text-amber-300 transition-colors"
                    >
                      <span className="w-2.5 h-0.5 bg-amber-400 rounded-full" style={{ opacity: showGyro ? 1 : 0.3 }} />
                      Rotasi Gyro (rad/s)² [Kanan]
                    </button>
                  </div>
                  <span className="text-slate-500">
                    {effectiveWaveform.length} titik sampel · {parsedWaveform.length > 0 ? "20 Hz Pure Live" : "20 Hz Rekonstruksi Fitur"}
                  </span>
                </div>
              </div>

              {/* PARAMETER KINEMATIKA TERSTRUKTUR */}
              <div className="space-y-3">
                {/* GRUP A: INFERENSI GHMM (HANYA UNTUK AUTH) */}
                {isAuth && (
                  <div className="p-3 rounded-xl border border-slate-200/90 bg-slate-50/60">
                    <div className="flex items-center gap-1.5 mb-2.5">
                      <Cpu size={14} className="text-blue-600" />
                      <p style={{ color: "#0F172A", fontFamily: SANS, fontWeight: 700, fontSize: "0.78rem" }}>
                        Evaluasi Keputusan & Inferensi GHMM
                      </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div className="p-2.5 bg-white rounded-lg border border-slate-200 shadow-2xs">
                        <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.52rem", textTransform: "uppercase" }}>
                          Skor Keyakinan (CIR)
                        </p>
                        <p style={{ color: isSuccess ? "#16A34A" : "#DC2626", fontFamily: MONO, fontSize: "0.95rem", fontWeight: 800, marginTop: 2 }}>
                          {summaryMetrics.score ? (String(summaryMetrics.score).endsWith("%") ? summaryMetrics.score : `${summaryMetrics.score}%`) : "—"}
                        </p>
                        <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.5rem", marginTop: 2 }}>
                          {isSuccess ? "Lolos Ambang (≥80.0%)" : "Ditolak (<80.0%)"}
                        </p>
                      </div>

                      <div className="p-2.5 bg-white rounded-lg border border-slate-200 shadow-2xs">
                        <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.52rem", textTransform: "uppercase" }}>
                          Log-Likelihood (ln αT / t)
                        </p>
                        <p style={{ color: "#2563EB", fontFamily: MONO, fontSize: "0.95rem", fontWeight: 800, marginTop: 2 }}>
                          {summaryMetrics.logLikelihood}
                        </p>
                        <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.5rem", marginTop: 2 }}>
                          Forward Algorithm (Length-Normalized)
                        </p>
                      </div>

                      <div className="p-2.5 bg-white rounded-lg border border-slate-200 shadow-2xs">
                        <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.52rem", textTransform: "uppercase" }}>
                          Ambang Dinamis (Th)
                        </p>
                        <p style={{ color: "#D97706", fontFamily: MONO, fontSize: "0.95rem", fontWeight: 800, marginTop: 2 }}>
                          {summaryMetrics.adaptiveThreshold}
                        </p>
                        <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.5rem", marginTop: 2 }}>
                          Peak Tracking (Margin 1.15x)
                        </p>
                      </div>
                    </div>

                    {/* DROPDOWN BREAKDOWN CIR PER PENGGUNA (MULTICLASS GHMM) */}
                    <div className="mt-3 rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
                      <button
                        type="button"
                        onClick={() => setShowBreakdown((prev) => !prev)}
                        className="w-full px-3.5 py-2.5 flex items-center justify-between bg-slate-50/80 hover:bg-slate-100/80 transition-colors cursor-pointer text-left"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded-md flex items-center justify-center bg-blue-100 text-blue-700">
                            <Users size={12} />
                          </div>
                          <div>
                            <p style={{ color: "#0F172A", fontFamily: SANS, fontWeight: 700, fontSize: "0.72rem" }}>
                              Breakdown Skor Keyakinan (CIR) per Pengguna
                            </p>
                            <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.55rem" }}>
                              Evaluasi simultan terhadap model profil pemilik terdaftar
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[0.58rem] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200" style={{ fontFamily: MONO }}>
                            {showBreakdown ? "Sembunyikan" : "Buka Rincian"}
                          </span>
                          {showBreakdown ? <ChevronUp size={15} className="text-slate-500" /> : <ChevronDown size={15} className="text-slate-500" />}
                        </div>
                      </button>

                      <AnimatePresence>
                        {showBreakdown && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="border-t border-slate-100 p-3 flex flex-col gap-2.5"
                          >
                            {/* Bar info */}
                            <div className="flex items-center justify-between pb-1 border-b border-slate-100">
                              <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.58rem" }}>
                                Daftar Slot Pemilik yang Dievaluasi:
                              </p>
                            </div>

                            {/* Item per slot terdaftar */}
                            <div className="space-y-2">
                              {evaluatedSlots.length === 0 ? (
                                <p className="text-center py-2 text-slate-400 text-xs font-mono">
                                  Belum ada profil pengguna lain yang terdaftar di sistem.
                                </p>
                              ) : (
                                evaluatedSlots.map((item) => (
                                  <div
                                    key={item.slot}
                                    className="p-2.5 rounded-lg border flex flex-col gap-1.5 transition-all"
                                    style={{
                                      background: item.isBestMatch ? "#F0FDF4" : "#F8FAFC",
                                      borderColor: item.isBestMatch ? "#86EFAC" : "#E2E8F0",
                                    }}
                                  >
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-1.5">
                                        <span
                                          className="px-1.5 py-0.5 rounded text-[0.55rem] font-bold"
                                          style={{
                                            background: item.isBestMatch ? "#DCFCE7" : "#E2E8F0",
                                            color: item.isBestMatch ? "#15803D" : "#475569",
                                            fontFamily: MONO,
                                          }}
                                        >
                                          SLOT 0{item.slot + 1}
                                        </span>
                                        <span style={{ color: "#0F172A", fontFamily: SANS, fontWeight: 700, fontSize: "0.72rem" }}>
                                          {item.name}
                                        </span>
                                        {item.isBestMatch && (
                                          <span className="px-1.5 py-0.2 rounded text-[0.5rem] font-bold bg-green-600 text-white" style={{ fontFamily: MONO }}>
                                            KANDIDAT TERBAIK
                                          </span>
                                        )}
                                        {item.isDeletedNow && (
                                          <span className="px-1 py-0.2 rounded text-[0.48rem] font-semibold bg-slate-200 text-slate-600 italic" style={{ fontFamily: MONO }}>
                                            Slot Telah Dihapus Nanti
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <span
                                          style={{
                                            fontFamily: MONO,
                                            fontSize: "0.82rem",
                                            fontWeight: 800,
                                            color: item.score >= 80 ? "#16A34A" : item.score >= 50 ? "#D97706" : "#DC2626",
                                          }}
                                        >
                                          {item.score.toFixed(1)}%
                                        </span>
                                      </div>
                                    </div>

                                    {/* Progress bar visual dengan ambang 80% */}
                                    <div className="relative w-full h-2 rounded-full bg-slate-200/80 overflow-hidden">
                                      <div
                                        className="h-full rounded-full transition-all duration-500"
                                        style={{
                                          width: `${Math.min(Math.max(item.score, 0), 100)}%`,
                                          background: item.score >= 80 ? "linear-gradient(90deg, #22C55E, #16A34A)" : item.score >= 50 ? "linear-gradient(90deg, #F59E0B, #D97706)" : "linear-gradient(90deg, #EF4444, #DC2626)",
                                        }}
                                      />
                                      {/* Garis batas ambang 80% */}
                                      <div
                                        className="absolute top-0 bottom-0 w-0.5 bg-slate-600/70"
                                        style={{ left: "80%" }}
                                        title="Ambang Batas Sah (80.0%)"
                                      />
                                    </div>

                                    <div className="flex items-center justify-between text-[0.52rem]" style={{ fontFamily: MONO }}>
                                      <span style={{ color: item.score >= 80 ? "#15803D" : "#64748B" }}>
                                        {item.score >= 80 ? "✓ Lolos Ambang Biometrik (≥80%)" : "✗ Belum Mencapai Ambang (<80%)"}
                                      </span>
                                      <span className="text-slate-400">
                                        Batas Ambang: 80.0%
                                      </span>
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                )}

                {/* GRUP B: VEKTOR CIRI 5-FITUR (FEATURE EXTRACTION) */}
                <div className="p-3 rounded-xl border border-slate-200/90 bg-slate-50/60">
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <Layers size={14} className="text-emerald-600" />
                    <p style={{ color: "#0F172A", fontFamily: SANS, fontWeight: 700, fontSize: "0.78rem" }}>
                      Vektor Ciri 5-Fitur Biometrik (Feature Extraction)
                    </p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    <div className="p-2 bg-white rounded-lg border border-slate-200 shadow-2xs">
                      <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.5rem", textTransform: "uppercase" }}>
                        Mean Gyro (μ)
                      </p>
                      <p style={{ color: "#0F172A", fontFamily: MONO, fontSize: "0.78rem", fontWeight: 800, marginTop: 1 }}>
                        {summaryMetrics.mean !== "—" ? `${summaryMetrics.mean} °/s` : "—"}
                      </p>
                      <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.46rem" }}>
                        Rata-rata Putaran
                      </p>
                    </div>

                    <div className="p-2 bg-white rounded-lg border border-slate-200 shadow-2xs">
                      <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.5rem", textTransform: "uppercase" }}>
                        Variansi (σ²)
                      </p>
                      <p style={{ color: "#0F172A", fontFamily: MONO, fontSize: "0.78rem", fontWeight: 800, marginTop: 1 }}>
                        {summaryMetrics.variance}
                      </p>
                      <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.46rem" }}>
                        Dinamika Putaran
                      </p>
                    </div>

                    <div className="p-2 bg-white rounded-lg border border-slate-200 shadow-2xs">
                      <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.5rem", textTransform: "uppercase" }}>
                        Cadence (R)
                      </p>
                      <p style={{ color: "#0F172A", fontFamily: MONO, fontSize: "0.78rem", fontWeight: 800, marginTop: 1 }}>
                        {summaryMetrics.stdDev !== "—" ? `${summaryMetrics.stdDev}%` : "—"}
                      </p>
                      <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.46rem" }}>
                        Keteraturan Irama
                      </p>
                    </div>

                    <div className="p-2 bg-white rounded-lg border border-slate-200 shadow-2xs">
                      <p style={{ color: "#0891B2", fontFamily: MONO, fontSize: "0.5rem", textTransform: "uppercase" }}>
                        Periode (k)
                      </p>
                      <p style={{ color: "#0891B2", fontFamily: MONO, fontSize: "0.78rem", fontWeight: 800, marginTop: 1 }}>
                        {summaryMetrics.skewness !== "—" ? `${summaryMetrics.skewness} smp` : "—"}
                      </p>
                      <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.46rem" }}>
                        Lag Autokorelasi
                      </p>
                    </div>

                    <div className="p-2 bg-white rounded-lg border border-slate-200 shadow-2xs col-span-2 sm:col-span-1">
                      <p style={{ color: "#7C3AED", fontFamily: MONO, fontSize: "0.5rem", textTransform: "uppercase" }}>
                        Hentakan (Acc)
                      </p>
                      <p style={{ color: "#7C3AED", fontFamily: MONO, fontSize: "0.78rem", fontWeight: 800, marginTop: 1 }}>
                        {summaryMetrics.kurtosis !== "—" ? `${summaryMetrics.kurtosis} %g` : "—"}
                      </p>
                      <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.46rem" }}>
                        Ground Reaction Force
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. TABEL RINCIAN PER JENDELA (KOLOM DIKELOMPOKKAN DENGAN RAPI) */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p style={{ color: "#0F172A", fontFamily: SANS, fontWeight: 700, fontSize: "0.78rem" }}>
                    Rincian Tiap Jendela Langkah (Per-Window Breakdown)
                  </p>
                  <span
                    className="px-2 py-0.5 rounded text-[0.55rem] font-bold"
                    style={{ background: "#F1F5F9", color: "#64748B", fontFamily: MONO }}
                  >
                    {parsedDetails.length} JENDELA TERCATAT
                  </span>
                </div>

                {parsedDetails.length > 0 ? (
                  <div className="border border-slate-200 rounded-xl overflow-x-auto shadow-xs">
                    <table className="w-full text-left" style={{ fontFamily: MONO, fontSize: "0.62rem" }}>
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                        <tr>
                          <th className="py-2.5 px-3 w-20">Jendela</th>
                          <th className="py-2.5 px-3">Vektor Ciri 5D (Feature Extraction)</th>
                          {isAuth && <th className="py-2.5 px-3">Evaluasi GHMM & Ambang</th>}
                          <th className="py-2.5 px-3 text-right">{isAuth ? "Status Ambang" : "Status Langkah"}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {parsedDetails.map((item, idx) => {
                          const confNum = parseFloat(String(item.confidence ?? item.score ?? 0));
                          const isAbove80 = !isNaN(confNum) ? confNum >= 80.0 : false;

                          return (
                            <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                              {/* Kolom 1: Jendela & Waktu */}
                              <td className="py-2.5 px-3 font-bold text-slate-800 align-top">
                                #{item.step || idx + 1}
                                <span className="block text-[0.5rem] text-slate-400 font-normal">
                                  {item.time?.split(" ")[1] || `${((idx + 1) * 1.5).toFixed(1)}s`}
                                </span>
                              </td>

                              {/* Kolom 2: Vektor Ciri 5D Rapi */}
                              <td className="py-2.5 px-3 text-slate-700 align-top">
                                <div className="space-y-0.5">
                                  <p className="font-semibold text-slate-800">
                                    μ: <span className="text-emerald-700">{item.mean ?? "—"}°/s</span> · σ²: <span>{item.variance ?? "—"}</span> · R: <span>{item.stdDev ?? "—"}%</span>
                                  </p>
                                  <p className="text-[0.55rem] text-slate-500">
                                    Periode (k): <span className="text-cyan-700 font-medium">{item.skewness ?? "—"} smp</span> · Hentakan: <span className="text-purple-700 font-medium">{item.kurtosis ?? "—"} %g</span>
                                  </p>
                                </div>
                              </td>

                              {/* Kolom 3: GHMM (Hanya ditampilkan pada Auth) */}
                              {isAuth && (
                                <td className="py-2.5 px-3 align-top">
                                  <div className="space-y-0.5">
                                    <p className="font-bold text-blue-600">
                                      Skor: {(() => {
                                        const rawVal = item.confidence ?? item.score;
                                        if (rawVal === undefined || rawVal === null || rawVal === "—") return "—";
                                        const strVal = String(rawVal);
                                        return strVal.endsWith("%") ? strVal : `${strVal}%`;
                                      })()}
                                      <span className="text-slate-400 font-normal text-[0.5rem] ml-1.5">
                                        LL: {item.logLikelihood ?? "—"}
                                      </span>
                                    </p>
                                    <p className="text-[0.52rem] text-slate-500">
                                      Th: <span className="text-amber-600">{item.adaptiveThreshold ?? "—"}</span>
                                    </p>
                                  </div>
                                </td>
                              )}

                              {/* Kolom 4 (atau Kolom 3 pada Registrasi): Status */}
                              <td className="py-2.5 px-3 text-right align-top">
                                <span className="block text-[0.54rem] text-slate-500 mb-1">
                                  {item.zupt?.includes("Melangkah") || item.zupt?.includes("VALID") ? "● Melangkah" : "○ Diam"}
                                </span>
                                {isAuth ? (
                                  <span
                                    className="inline-block px-1.5 py-0.5 rounded text-[0.52rem] font-bold"
                                    style={{
                                      background: isAbove80 ? "#DCFCE7" : "#FEF3C7",
                                      color: isAbove80 ? "#16A34A" : "#D97706",
                                      border: `1px solid ${isAbove80 ? "#BBF7D0" : "#FDE68A"}`,
                                    }}
                                  >
                                    {isAbove80 ? "≥80%" : "<80%"}
                                  </span>
                                ) : (
                                  <span
                                    className="inline-block px-1.5 py-0.5 rounded text-[0.52rem] font-bold"
                                    style={{
                                      background: "#DCFCE7",
                                      color: "#16A34A",
                                      border: "1px solid #BBF7D0",
                                    }}
                                  >
                                    VALID
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl border border-dashed border-slate-200 text-center text-slate-500 text-xs">
                    Rincian langkah belum tersedia untuk rekaman ini.
                  </div>
                )}
              </div>
            </>
          )}
        </div>

            {/* Footer Modal */}
            <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between bg-slate-50/80">
              {isSyncedFromFlash ? (
                <span className="text-[0.6rem] text-slate-400 font-mono italic">
                  Data CSV riwayat mentah tersimpan di perangkat perekam
                </span>
              ) : (
                <button
                  onClick={handleExportDetailCSV}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 font-bold transition-all active:scale-95 cursor-pointer text-xs shadow-xs"
                  style={{ fontFamily: MONO }}
                  title="Unduh file CSV komprehensif dari rincian telemetri dan titik gelombang"
                >
                  <Download size={13} />
                  <span>Unduh CSV Rincian</span>
                </button>
              )}

              <button
                onClick={onClose}
                className="px-5 py-2 rounded-xl text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 font-bold transition-all active:scale-95 cursor-pointer text-xs shadow-xs"
                style={{ fontFamily: MONO }}
              >
                TUTUP
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
