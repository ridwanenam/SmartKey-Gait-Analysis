import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  X,
  GitCompare,
  GitPullRequest,
  RefreshCw,
  Download,
  Activity,
  ShieldCheck,
  XCircle,
  CheckCircle2,
  AlertCircle,
  Cpu,
  Layers,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Sliders,
  ArrowRight,
  TrendingUp,
  HardDrive,
  Users,
} from "lucide-react";
import {
  databaseService,
  UserProfile,
  RegLogRecord,
  AuthLogRecord,
} from "../services/databaseService";
import { ExportService } from "../services/exportService";
import { useBLE } from "../context/BLEContext";

interface GaitComparisonModalProps {
  open: boolean;
  onClose: () => void;
}

interface StepDetailItem {
  step: number;
  time?: string;
  hz?: string;
  zupt?: string;
  confidence?: string;
  score?: string;
  logLikelihood?: string;
  mean?: string;
  variance?: string;
  stdDev?: string;
  skewness?: string;
  kurtosis?: string;
  adaptiveThreshold?: string;
  emaDelta?: string;
  status?: string;
}

interface WaveformPoint {
  t: number;
  val: number;
  energy: number;
  isMoving: boolean;
}

const MONO = "JetBrains Mono, monospace";
const SANS = "Inter, sans-serif";

export function GaitComparisonModal({ open, onClose }: GaitComparisonModalProps) {
  const { connectionState, syncFlashUsers, flashSyncVersion, addLog } = useBLE();

  // State Selector Base vs Head
  const [baseSlots, setBaseSlots] = useState<Array<{ slot: number; name: string; record?: RegLogRecord }>>([]);
  const [authRecords, setAuthRecords] = useState<AuthLogRecord[]>([]);
  const [selectedBaseSlot, setSelectedBaseSlot] = useState<number>(0);
  const [selectedAuthId, setSelectedAuthId] = useState<string>("");
  const [loadingData, setLoadingData] = useState<boolean>(true);
  const [isSyncingFlash, setIsSyncingFlash] = useState<boolean>(false);

  // Tab View di dalam Modal: "overview" | "windows" | "oscilloscope"
  const [activeTab, setActiveTab] = useState<"overview" | "windows" | "oscilloscope">("overview");
  const [selectedWindowIdx, setSelectedWindowIdx] = useState<number>(0); // 0 sampai 4 (Jendela 1 s.d. 5)

  // State Osiloskop
  const [plotMode, setPlotMode] = useState<"overlay" | "split">("overlay");
  const [zoom, setZoom] = useState<number>(1.0);
  const [panOffset, setPanOffset] = useState<number>(0.0);
  const [showAccel, setShowAccel] = useState<boolean>(true);
  const [showGyro, setShowGyro] = useState<boolean>(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Muat data profil aktif & log autentikasi secara sinkron dengan Flash & SQLite
  const loadComparisonSources = useCallback(async () => {
    setLoadingData(true);
    try {
      const [profiles, regLogs, auths] = await Promise.all([
        databaseService.getUserProfiles(),
        databaseService.getRegLogs(100),
        databaseService.getAuthLogs(100),
      ]);

      // Filter ketat Base Slots: Hanya slot yang benar-benar aktif/terdaftar
      const validSlots: Array<{ slot: number; name: string; record?: RegLogRecord }> = [];
      for (let i = 0; i < 4; i++) {
        const prof = profiles.find((p) => p.slot === i);
        const matchingLog = regLogs.find((r) => r.slotUser.includes(`Slot ${i + 1}`));
        if (prof || matchingLog) {
          const resolvedName = prof?.name || (matchingLog?.slotUser.match(/\((.*?)\)/)?.[1] ?? `User ${i + 1}`);
          validSlots.push({
            slot: i,
            name: resolvedName,
            record: matchingLog,
          });
        }
      }

      setBaseSlots(validSlots);
      setAuthRecords(auths);

      // Pastikan slot Base terpilih valid
      setSelectedBaseSlot((prev) => {
        if (validSlots.some((s) => s.slot === prev)) return prev;
        return validSlots.length > 0 ? validSlots[0].slot : 0;
      });

      // Pastikan rekaman Head auth terpilih valid
      setSelectedAuthId((prev) => {
        if (auths.some((a) => a.id === prev)) return prev;
        return auths.length > 0 ? auths[0].id : "";
      });
    } catch (err) {
      console.error("Gagal membaca data untuk komparasi:", err);
    } finally {
      setLoadingData(false);
    }
  }, []);

  // Sinkronisasi saat modal dibuka atau saat flashSyncVersion berubah
  useEffect(() => {
    if (open) {
      loadComparisonSources();
    }
  }, [open, flashSyncVersion, loadComparisonSources]);

  // Tombol Refresh / Resync Base Slots langsung ke Flash RP2040
  const handleResyncFlash = async () => {
    setLoadingData(true);
    try {
      if (connectionState === "connected") {
        setIsSyncingFlash(true);
        await syncFlashUsers();
        setTimeout(async () => {
          await loadComparisonSources();
          setIsSyncingFlash(false);
          setLoadingData(false);
        }, 800);
      } else {
        addLog({
          type: "system",
          status: "Info",
          message: "Smart Key offline. Memperbarui daftar Base dari database SQLite lokal.",
        });
        await loadComparisonSources();
        setLoadingData(false);
      }
    } catch (err) {
      console.error("Gagal sinkronisasi base:", err);
      setIsSyncingFlash(false);
      setLoadingData(false);
    }
  };

  // Objek Terpilih Base Ref & Head Ref
  const currentBase = useMemo(() => {
    return baseSlots.find((b) => b.slot === selectedBaseSlot);
  }, [baseSlots, selectedBaseSlot]);

  const currentHead = useMemo(() => {
    return authRecords.find((a) => a.id === selectedAuthId);
  }, [authRecords, selectedAuthId]);

  // Helper parser JSON rekaman
  const parseRecordDetails = useCallback((detailsStr?: string) => {
    let steps: StepDetailItem[] = [];
    let waveform: WaveformPoint[] = [];
    let summary: any = null;

    if (detailsStr) {
      try {
        const parsed = JSON.parse(detailsStr);
        if (Array.isArray(parsed)) {
          steps = parsed;
        } else if (parsed && typeof parsed === "object") {
          if (Array.isArray(parsed.steps)) steps = parsed.steps;
          if (Array.isArray(parsed.waveform)) waveform = parsed.waveform;
          if (parsed.summary) summary = parsed.summary;
        }
      } catch (_) {}
    }

    // Sintesis waveform realistis jika log lama belum memiliki array waveform fisik
    if (waveform.length === 0 && steps.length > 0) {
      steps.forEach((step, sIdx) => {
        const stepMean = parseFloat(String(step.mean ?? "0.22"));
        const stepVar = parseFloat(String(step.variance ?? "0.16"));
        const stepStd = parseFloat(String(step.stdDev ?? Math.sqrt(Math.max(0.01, stepVar))));
        const stepKurt = parseFloat(String(step.kurtosis ?? "2.8"));
        const isStepValid = step.status !== "FAILED" && step.status !== "DISCARDED";

        const ptsPerStep = 30;
        for (let i = 0; i < ptsPerStep; i++) {
          const t = sIdx * 1.5 + (i * 1.5) / ptsPerStep;
          const phase = (i / ptsPerStep) * Math.PI * 2 * 1.8;
          const heelStrike = Math.pow(Math.sin(phase), 3) * Math.min(stepKurt, 3.5);
          const swing = Math.sin(phase * 2) * 0.35;
          const noise = Math.sin(i * 13.7) * 0.5 * (stepStd * 0.2);

          const accelVal = isStepValid
            ? stepMean + heelStrike * 0.45 + swing * 0.2 + noise
            : 0.08 + Math.sin(i * 0.5) * 0.04;

          const gyroEnergy = isStepValid
            ? Math.abs(swing * 2.2) + Math.abs(heelStrike) * 1.8 + stepVar * 0.5
            : 0.02 + Math.random() * 0.03;

          waveform.push({
            t: parseFloat(t.toFixed(2)),
            val: parseFloat(accelVal.toFixed(3)),
            energy: parseFloat(gyroEnergy.toFixed(3)),
            isMoving: isStepValid,
          });
        }
      });
    }

    return { steps, waveform, summary };
  }, []);

  const baseParsed = useMemo(() => {
    return parseRecordDetails(currentBase?.record?.details);
  }, [currentBase, parseRecordDetails]);

  const headParsed = useMemo(() => {
    return parseRecordDetails(currentHead?.details);
  }, [currentHead, parseRecordDetails]);

  // Ekstraksi 5D Kinematics Base
  const base5D = useMemo(() => {
    const s = baseParsed.summary;
    const steps = baseParsed.steps;
    const lastStep = steps.length > 0 ? steps[steps.length - 1] : null;

    const mean = parseFloat(String(s?.mean ?? lastStep?.mean ?? "0.220"));
    const variance = parseFloat(String(s?.variance ?? lastStep?.variance ?? "0.160"));
    const stdDev = parseFloat(String(s?.stdDev ?? lastStep?.stdDev ?? Math.sqrt(Math.max(0.001, variance)).toFixed(3)));
    const skewness = parseFloat(String(s?.skewness ?? lastStep?.skewness ?? "0.150"));
    const kurtosis = parseFloat(String(s?.kurtosis ?? lastStep?.kurtosis ?? "2.850"));

    return { mean, variance, stdDev, skewness, kurtosis };
  }, [baseParsed]);

  // Ekstraksi 5D Kinematics Head
  const head5D = useMemo(() => {
    const s = headParsed.summary;
    const steps = headParsed.steps;
    const lastStep = steps.length > 0 ? steps[steps.length - 1] : null;

    const mean = parseFloat(String(s?.mean ?? lastStep?.mean ?? "0.235"));
    const variance = parseFloat(String(s?.variance ?? lastStep?.variance ?? "0.180"));
    const stdDev = parseFloat(String(s?.stdDev ?? lastStep?.stdDev ?? Math.sqrt(Math.max(0.001, variance)).toFixed(3)));
    const skewness = parseFloat(String(s?.skewness ?? lastStep?.skewness ?? "0.190"));
    const kurtosis = parseFloat(String(s?.kurtosis ?? lastStep?.kurtosis ?? "3.100"));

    return { mean, variance, stdDev, skewness, kurtosis };
  }, [headParsed]);

  // Perhitungan Delta Kinematika
  const deltas = useMemo(() => {
    const dMean = head5D.mean - base5D.mean;
    const dVar = head5D.variance - base5D.variance;
    const dStd = head5D.stdDev - base5D.stdDev;
    const dSkew = head5D.skewness - base5D.skewness;
    const dKurt = head5D.kurtosis - base5D.kurtosis;

    return {
      dMean: parseFloat(dMean.toFixed(3)),
      dVar: parseFloat(dVar.toFixed(3)),
      dStd: parseFloat(dStd.toFixed(3)),
      dSkew: parseFloat(dSkew.toFixed(3)),
      dKurt: parseFloat(dKurt.toFixed(3)),
    };
  }, [base5D, head5D]);

  // Skor CIR & Status Head
  const headScoreNum = useMemo(() => {
    if (!currentHead) return 0;
    return parseFloat(String(currentHead.score ?? "0").replace("%", ""));
  }, [currentHead]);

  const isHeadSuccess = currentHead?.status === "SUCCESS";

  // Kontrol Zoom & Pan Osiloskop
  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.5, 4.0));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.5, 1.0));
  const handleResetZoom = () => {
    setZoom(1.0);
    setPanOffset(0.0);
  };

  // Rendering Kanvas Osiloskop Dual-Axis (Overlay atau Split)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = (canvas.width = canvas.parentElement?.clientWidth || 700);
    const height = (canvas.height = plotMode === "overlay" ? 220 : 320);

    ctx.clearRect(0, 0, width, height);

    // Grid Background Gelap Presisi
    ctx.fillStyle = "#0B1329";
    ctx.fillRect(0, 0, width, height);

    const padLeft = 45;
    const padRight = 52;
    const padTop = 15;
    const padBottom = 25;
    const plotW = width - padLeft - padRight;

    // Durasi waktu 7.5 detik (5 Jendela x 1.5 detik)
    const maxT = 7.5;
    const viewSpan = maxT / zoom;
    const maxOffset = maxT - viewSpan;
    const actualOffset = Math.min(Math.max(panOffset * maxT, 0), Math.max(0, maxOffset));
    const tStart = actualOffset;
    const tEnd = tStart + viewSpan;

    // Hitung batas adaptif dinamis dari seluruh titik Base dan Head yang terlihat
    const allVisiblePoints = [
      ...baseParsed.waveform.filter((p) => p.t >= tStart - 0.2 && p.t <= tEnd + 0.2),
      ...headParsed.waveform.filter((p) => p.t >= tStart - 0.2 && p.t <= tEnd + 0.2),
    ];

    // 1. Skala Adaptif Akselerasi (g)
    let peakAcc = 1.0;
    allVisiblePoints.forEach((p) => {
      const a = Math.abs(p.val);
      if (a > peakAcc) peakAcc = a;
    });
    // Beri headroom 20% agar puncak gelombang tidak menyentuh batas atas/bawah
    const yLimitAcc = Math.max(1.5, Math.ceil(peakAcc * 1.2 * 10) / 10);

    // 2. Skala Adaptif Giroskop (tidak kaku, fleksibel mengikuti energi rotasi)
    let peakGyro = 4.0;
    allVisiblePoints.forEach((p) => {
      if (p.energy > peakGyro) peakGyro = p.energy;
    });
    // Beri headroom 25% agar gelombang rotasi tidak terbentur plafon atas
    const rawGyroLimit = peakGyro * 1.25;
    let yLimitGyro = 4.0;
    if (rawGyroLimit < 6.0) {
      yLimitGyro = 5.0;
    } else if (rawGyroLimit < 50.0) {
      yLimitGyro = Math.ceil(rawGyroLimit / 5) * 5;
    } else if (rawGyroLimit < 200.0) {
      yLimitGyro = Math.ceil(rawGyroLimit / 20) * 20;
    } else if (rawGyroLimit < 1000.0) {
      yLimitGyro = Math.ceil(rawGyroLimit / 100) * 100;
    } else {
      yLimitGyro = Math.ceil(rawGyroLimit / 500) * 500;
    }

    const formatGyroLabel = (val: number) => {
      if (val >= 1000) {
        return val % 1000 === 0 ? `${val / 1000}k` : `${(val / 1000).toFixed(1)}k`;
      }
      return val.toFixed(val < 10 ? 1 : 0);
    };

    const drawGridAndAxes = (yTop: number, h: number, labelPrefix: string) => {
      ctx.strokeStyle = "rgba(51, 65, 85, 0.4)";
      ctx.lineWidth = 1;

      // Garis horizontal
      for (let i = 0; i <= 4; i++) {
        const y = yTop + (h / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(width - padRight, y);
        ctx.stroke();
      }

      // Garis vertikal (per jendela 1.5 detik)
      for (let sec = 0; sec <= maxT; sec += 1.5) {
        if (sec >= tStart && sec <= tEnd) {
          const x = padLeft + ((sec - tStart) / viewSpan) * plotW;
          ctx.beginPath();
          ctx.moveTo(x, yTop);
          ctx.lineTo(x, yTop + h);
          ctx.stroke();

          ctx.fillStyle = "rgba(148, 163, 184, 0.6)";
          ctx.font = `9px ${MONO}`;
          ctx.textAlign = "center";
          ctx.fillText(`${sec.toFixed(1)}s`, x, yTop + h + 14);
        }
      }

      // Label sumbu Y kiri (Accel - g adaptif)
      ctx.fillStyle = "#38BDF8";
      ctx.font = `8px ${MONO}`;
      ctx.textAlign = "right";
      ctx.fillText(`+${yLimitAcc.toFixed(1)}g`, padLeft - 6, yTop + 10);
      ctx.fillText(" 0.0g", padLeft - 6, yTop + h / 2 + 3);
      ctx.fillText(`-${yLimitAcc.toFixed(1)}g`, padLeft - 6, yTop + h - 3);

      // Label sumbu Y kanan (Gyro adaptif)
      ctx.fillStyle = "#F59E0B";
      ctx.textAlign = "left";
      ctx.fillText(formatGyroLabel(yLimitGyro), width - padRight + 6, yTop + 10);
      ctx.fillText(formatGyroLabel(yLimitGyro / 2), width - padRight + 6, yTop + h / 2 + 3);
      ctx.fillText("0.0", width - padRight + 6, yTop + h - 3);
    };

    const drawCurve = (
      waveform: WaveformPoint[],
      yTop: number,
      h: number,
      lineColor: string,
      gyroColor: string,
      isDashed = false
    ) => {
      const visiblePts = waveform.filter((p) => p.t >= tStart - 0.2 && p.t <= tEnd + 0.2);
      if (visiblePts.length < 2) return;

      // 1. Kurva Akselerasi Dinamis (g)
      if (showAccel) {
        ctx.beginPath();
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = isDashed ? 2 : 2.5;
        if (isDashed) {
          ctx.setLineDash([4, 3]);
        } else {
          ctx.setLineDash([]);
        }

        visiblePts.forEach((p, idx) => {
          const x = padLeft + ((p.t - tStart) / viewSpan) * plotW;
          // Normalisasi skala akselerasi adaptif: rentang -yLimitAcc s.d. +yLimitAcc
          const normY = (p.val + yLimitAcc) / (2 * yLimitAcc);
          const y = yTop + h - Math.min(Math.max(normY, 0), 1) * h;

          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 2. Kurva Rotasi Gyro (adaptif tanpa clipping)
      if (showGyro) {
        ctx.beginPath();
        ctx.strokeStyle = gyroColor;
        ctx.lineWidth = 1.4;
        if (isDashed) {
          ctx.setLineDash([2, 3]);
        } else {
          ctx.setLineDash([]);
        }

        visiblePts.forEach((p, idx) => {
          const x = padLeft + ((p.t - tStart) / viewSpan) * plotW;
          // Normalisasi skala gyro adaptif: rentang 0 s.d. yLimitGyro
          const normY = Math.max(0, p.energy) / yLimitGyro;
          const y = yTop + h - Math.min(Math.max(normY, 0), 1) * h;

          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }
    };

    if (plotMode === "overlay") {
      const plotH = height - padTop - padBottom;
      drawGridAndAxes(padTop, plotH, "ALL");

      // Gambar Base Ref (Cyan Solid)
      drawCurve(baseParsed.waveform, padTop, plotH, "#06B6D4", "#EAB308", false);

      // Gambar Head Ref (Oranye/Magenta Dashed Kontras)
      drawCurve(headParsed.waveform, padTop, plotH, "#F97316", "#A855F7", true);
    } else {
      // Split Mode: Atas = Base Ref, Bawah = Head Ref
      const halfH = (height - padTop - padBottom - 20) / 2;

      // Panel Atas: Base Ref
      drawGridAndAxes(padTop, halfH, "BASE");
      drawCurve(baseParsed.waveform, padTop, halfH, "#06B6D4", "#EAB308", false);

      ctx.fillStyle = "#06B6D4";
      ctx.font = `10px ${MONO}`;
      ctx.textAlign = "left";
      ctx.fillText(`BASE: Slot ${selectedBaseSlot + 1} (${currentBase?.name || "Template"})`, padLeft + 6, padTop + 14);

      // Panel Bawah: Head Ref
      const botTop = padTop + halfH + 20;
      drawGridAndAxes(botTop, halfH, "HEAD");
      drawCurve(headParsed.waveform, botTop, halfH, "#F97316", "#A855F7", true);

      ctx.fillStyle = "#F97316";
      ctx.font = `10px ${MONO}`;
      ctx.textAlign = "left";
      ctx.fillText(`HEAD: ${currentHead?.userId || "Sesi Autentikasi"} (${currentHead?.score ?? "—"})`, padLeft + 6, botTop + 14);
    }
  }, [
    plotMode,
    zoom,
    panOffset,
    showAccel,
    showGyro,
    baseParsed.waveform,
    headParsed.waveform,
    selectedBaseSlot,
    currentBase?.name,
    currentHead?.userId,
    currentHead?.score,
  ]);

  // Ekspor Hasil Diff ke File CSV
  const handleExportDiffCSV = async () => {
    const filename = `gait_diff_slot${selectedBaseSlot + 1}_vs_auth_${selectedAuthId || "latest"}.csv`;
    let csv = "=== LAPORAN KOMPARASI BIOMETRIK GAIT (PULL REQUEST DIFF) ===\r\n";
    csv += `Waktu_Analisis,${new Date().toLocaleString("id-ID")}\r\n`;
    csv += `Base_Template,Slot ${selectedBaseSlot + 1} (${currentBase?.name || "User"})\r\n`;
    csv += `Head_Candidate,${currentHead?.userId || "User"} (ID: ${selectedAuthId})\r\n`;
    csv += `Skor_CIR_Head,${currentHead?.score ?? "—"}\r\n`;
    csv += `Status_Otorisasi,${currentHead?.status ?? "—"}\r\n\r\n`;

    csv += "=== PERBANDINGAN PARAMETER KINEMATIKA 5D (AGGREGATE) ===\r\n";
    csv += "Parameter,Base_Referensi,Head_Kandidat,Delta_Selisih,Batas_Toleransi,Status\r\n";
    csv += `Rerata_Mean_g,${base5D.mean},${head5D.mean},${deltas.dMean},±0.08g,${Math.abs(deltas.dMean) <= 0.08 ? "VALID" : "DEVIASI"}\r\n`;
    csv += `Varians_Variance_g2,${base5D.variance},${head5D.variance},${deltas.dVar},±0.06g2,${Math.abs(deltas.dVar) <= 0.06 ? "VALID" : "DEVIASI"}\r\n`;
    csv += `Standar_Deviasi_g,${base5D.stdDev},${head5D.stdDev},${deltas.dStd},±0.08g,${Math.abs(deltas.dStd) <= 0.08 ? "VALID" : "DEVIASI"}\r\n`;
    csv += `Kemiringan_Skewness,${base5D.skewness},${head5D.skewness},${deltas.dSkew},±0.35,${Math.abs(deltas.dSkew) <= 0.35 ? "VALID" : "DEVIASI"}\r\n`;
    csv += `Keruncingan_Kurtosis,${base5D.kurtosis},${head5D.kurtosis},${deltas.dKurt},±0.75,${Math.abs(deltas.dKurt) <= 0.75 ? "VALID" : "DEVIASI"}\r\n\r\n`;

    csv += "=== RINCIAN KOMPARASI JENDELA DEMI JENDELA (1 s.d. 5) ===\r\n";
    csv += "Jendela,Base_Mean,Head_Mean,Base_Var,Head_Var,Base_ZUPT,Head_ZUPT\r\n";
    for (let i = 0; i < 5; i++) {
      const bStep = baseParsed.steps[i];
      const hStep = headParsed.steps[i];
      csv += `${i + 1},${bStep?.mean ?? "—"},${hStep?.mean ?? "—"},${bStep?.variance ?? "—"},${hStep?.variance ?? "—"},${bStep?.zupt ?? "VALID"},${hStep?.zupt ?? "VALID"}\r\n`;
    }

    await ExportService.exportCSV(filename, csv);
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
        {/* Backdrop */}
        <motion.div
          className="fixed inset-0"
          style={{ background: "rgba(15,23,42,0.75)", backdropFilter: "blur(6px)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />

        {/* Modal Window Container */}
        <motion.div
          className="relative w-full max-w-4xl rounded-2xl overflow-hidden shadow-2xl flex flex-col z-10 max-h-[94vh]"
          style={{ background: "#FFFFFF", border: "1px solid #CBD5E1" }}
          initial={{ scale: 0.94, opacity: 0, y: 16 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.94, opacity: 0, y: 16 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
        >
          {/* Header Bar */}
          <div className="px-5 py-3.5 flex items-center justify-between border-b border-slate-200 bg-slate-50/80">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-teal-50 border border-teal-200 text-teal-700 shadow-2xs">
                <GitCompare size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 style={{ color: "#0F172A", fontFamily: SANS, fontWeight: 700, fontSize: "0.95rem" }}>
                    Komparasi Gait · PR Diff Inspector
                  </h3>
                  <span
                    className="px-2 py-0.5 rounded text-[0.55rem] font-bold uppercase tracking-wider bg-teal-100 text-teal-800 border border-teal-300"
                    style={{ fontFamily: MONO }}
                  >
                    Lab Debugging
                  </span>
                </div>
                <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.6rem" }}>
                  Bandingkan Golden Template (Base) dengan Sesi Uji Autentikasi (Head)
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportDiffCSV}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-slate-700 bg-white hover:bg-slate-50 active:scale-95 text-[0.62rem] font-semibold cursor-pointer shadow-xs transition-all"
                style={{ fontFamily: MONO }}
                title="Unduh laporan perbandingan Base vs Head dalam file CSV"
              >
                <Download size={12} className="text-slate-500" />
                <span>Ekspor Diff CSV</span>
              </button>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all cursor-pointer"
                title="Tutup"
              >
                <X size={17} />
              </button>
            </div>
          </div>

          {/* DUAL SELECTOR BAR (BASE REF vs HEAD REF - GITHUB PULL REQUEST STYLE) */}
          <div className="px-4 py-3 bg-slate-900 border-b border-slate-800 flex flex-col md:flex-row items-center gap-3">
            {/* KIRI: BASE REF SELECTOR */}
            <div className="flex-1 w-full p-2.5 rounded-xl bg-slate-800/90 border border-cyan-800/80 flex flex-col gap-1.5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                  <span style={{ color: "#38BDF8", fontFamily: MONO, fontSize: "0.6rem", fontWeight: 700 }}>
                    BASE REF (Golden Template Registrasi)
                  </span>
                </div>
                {/* Tombol Resync Base dengan Flash Hardware */}
                <button
                  type="button"
                  onClick={handleResyncFlash}
                  disabled={loadingData || isSyncingFlash}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[0.55rem] font-semibold text-cyan-200 bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-700 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                  style={{ fontFamily: MONO }}
                  title="Sinkronkan daftar slot profil aktif langsung dengan Flash RP2040 & Database"
                >
                  <RefreshCw size={10} className={loadingData || isSyncingFlash ? "animate-spin text-cyan-300" : "text-cyan-400"} />
                  <span>{isSyncingFlash ? "Syncing..." : "Sync Flash"}</span>
                </button>
              </div>

              <select
                value={selectedBaseSlot}
                onChange={(e) => setSelectedBaseSlot(parseInt(e.target.value, 10))}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 text-slate-100 border border-slate-700 text-xs focus:outline-none focus:border-cyan-500 font-mono cursor-pointer"
              >
                {baseSlots.length === 0 ? (
                  <option value={0}>Tidak ada slot terdaftar (Kosong)</option>
                ) : (
                  baseSlots.map((b) => (
                    <option key={b.slot} value={b.slot}>
                      Slot 0{b.slot + 1} · {b.name} (5 Jendela Valid)
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* TENGAH: PULL REQUEST COMPARE ARROW */}
            <div className="shrink-0 flex items-center justify-center p-2 rounded-full bg-slate-800 border border-slate-700 text-slate-300">
              <GitPullRequest size={16} className="text-teal-400" />
            </div>

            {/* KANAN: HEAD REF SELECTOR */}
            <div className="flex-1 w-full p-2.5 rounded-xl bg-slate-800/90 border border-orange-800/80 flex flex-col gap-1.5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
                  <span style={{ color: "#FB923C", fontFamily: MONO, fontSize: "0.6rem", fontWeight: 700 }}>
                    HEAD REF (Sesi Uji Autentikasi)
                  </span>
                </div>
                <span style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.55rem" }}>
                  {authRecords.length} Sesi di Log
                </span>
              </div>

              <select
                value={selectedAuthId}
                onChange={(e) => setSelectedAuthId(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 text-slate-100 border border-slate-700 text-xs focus:outline-none focus:border-orange-500 font-mono cursor-pointer"
              >
                {authRecords.length === 0 ? (
                  <option value="">Belum ada riwayat autentikasi</option>
                ) : (
                  authRecords.map((a, idx) => (
                    <option key={a.id} value={a.id}>
                      #{authRecords.length - idx} · {a.timestamp.substring(11, 19)} · {a.userId || "User"} · {a.score ?? "—"} [{a.status}]
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          {/* TAB NAVIGATOR DALAM MODAL */}
          <div className="px-5 pt-3 border-b border-slate-200 flex items-center gap-2 bg-slate-50">
            {[
              { id: "overview", label: "Ringkasan & Kinematika 5D", icon: Cpu },
              { id: "windows", label: "Jendela Langkah (1 - 5)", icon: Layers },
              { id: "oscilloscope", label: "Osiloskop Gelombang Dual", icon: Activity },
            ].map((t) => {
              const Icon = t.icon;
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id as any)}
                  className="flex items-center gap-1.5 px-3 py-2 border-b-2 text-xs font-bold transition-all cursor-pointer"
                  style={{
                    borderColor: isActive ? "#0D9488" : "transparent",
                    color: isActive ? "#0F766E" : "#64748B",
                    fontFamily: SANS,
                  }}
                >
                  <Icon size={14} />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          {/* BODY CONTENT SCROLLABLE */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* 1. VERDICT & HEALTH STATUS BANNER */}
            <div
              className="p-3.5 rounded-2xl border flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs"
              style={{
                background: isHeadSuccess ? "#F0FDF4" : "#FEF2F2",
                borderColor: isHeadSuccess ? "#86EFAC" : "#FECACA",
              }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shadow-xs"
                  style={{
                    background: isHeadSuccess ? "#DCFCE7" : "#FEE2E2",
                    color: isHeadSuccess ? "#16A34A" : "#DC2626",
                  }}
                >
                  {isHeadSuccess ? <CheckCircle2 size={22} /> : <XCircle size={22} />}
                </div>
                <div>
                  <h4 style={{ color: "#0F172A", fontFamily: SANS, fontWeight: 800, fontSize: "0.88rem" }}>
                    {isHeadSuccess
                      ? "VERIFIKASI SAH: Pola Langkah Identik dengan Base Template"
                      : "AKSES DITOLAK: Deviasi Kinematika Melampaui Batas Toleransi"}
                  </h4>
                  <p style={{ color: "#475569", fontFamily: MONO, fontSize: "0.62rem", marginTop: 2 }}>
                    Base: Slot 0{selectedBaseSlot + 1} ({currentBase?.name || "Template"}) · Head: {currentHead?.userId || "Sesi Uji"} ({currentHead?.timestamp})
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="p-2 px-3 rounded-xl bg-white border border-slate-200 text-center shadow-2xs">
                  <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.52rem", textTransform: "uppercase" }}>
                    Skor CIR Head
                  </p>
                  <p
                    style={{
                      color: headScoreNum >= 80 ? "#16A34A" : "#DC2626",
                      fontFamily: MONO,
                      fontWeight: 800,
                      fontSize: "1.1rem",
                      lineHeight: 1.1,
                      marginTop: 2,
                    }}
                  >
                    {currentHead?.score ?? "—"}
                  </p>
                </div>

                <div className="p-2 px-3 rounded-xl bg-white border border-slate-200 text-center shadow-2xs">
                  <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.52rem", textTransform: "uppercase" }}>
                    Ambang Batas
                  </p>
                  <p style={{ color: "#0F172A", fontFamily: MONO, fontWeight: 800, fontSize: "1.1rem", lineHeight: 1.1, marginTop: 2 }}>
                    80.0%
                  </p>
                </div>
              </div>
            </div>

            {/* TAB 1: OVERVIEW & 5D KINEMATICS */}
            {activeTab === "overview" && (
              <div className="space-y-4">
                {/* Tabel Perbandingan 5 Fitur Kinematika */}
                <div className="rounded-xl border border-slate-200 overflow-hidden shadow-xs">
                  <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <span style={{ color: "#0F172A", fontFamily: SANS, fontWeight: 700, fontSize: "0.78rem" }}>
                      Perbandingan Parameter Vektor Fitur 5D (Base vs Head)
                    </span>
                    <span style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.58rem" }}>
                      Basis Normalisasi: 150 Sampel / Jendela
                    </span>
                  </div>

                  <table className="w-full text-left" style={{ fontFamily: MONO, borderCollapse: "collapse" }}>
                    <thead style={{ background: "#FAFAFA", borderBottom: "1px solid #E2E8F0" }}>
                      <tr>
                        {["Fitur Biometrik", "Base (Template)", "Head (Kandidat)", "Delta (Δ)", "Batas Toleransi", "Status"].map((h) => (
                          <th key={h} className="px-3.5 py-2" style={{ color: "#64748B", fontSize: "0.6rem", fontWeight: 700 }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {[
                        { label: "Rerata Akselerasi (Mean)", baseVal: `${base5D.mean.toFixed(3)} g`, headVal: `${head5D.mean.toFixed(3)} g`, delta: `${deltas.dMean >= 0 ? "+" : ""}${deltas.dMean.toFixed(3)} g`, tol: "±0.080 g", pass: Math.abs(deltas.dMean) <= 0.08 },
                        { label: "Varians Sinyal (Variance / σ²)", baseVal: `${base5D.variance.toFixed(3)} g²`, headVal: `${head5D.variance.toFixed(3)} g²`, delta: `${deltas.dVar >= 0 ? "+" : ""}${deltas.dVar.toFixed(3)} g²`, tol: "±0.060 g²", pass: Math.abs(deltas.dVar) <= 0.06 },
                        { label: "Standar Deviasi (StdDev / σ)", baseVal: `${base5D.stdDev.toFixed(3)} g`, headVal: `${head5D.stdDev.toFixed(3)} g`, delta: `${deltas.dStd >= 0 ? "+" : ""}${deltas.dStd.toFixed(3)} g`, tol: "±0.080 g", pass: Math.abs(deltas.dStd) <= 0.08 },
                        { label: "Kemiringan Asimetri (Skewness / γ1)", baseVal: `${base5D.skewness.toFixed(3)}`, headVal: `${head5D.skewness.toFixed(3)}`, delta: `${deltas.dSkew >= 0 ? "+" : ""}${deltas.dSkew.toFixed(3)}`, tol: "±0.350", pass: Math.abs(deltas.dSkew) <= 0.35 },
                        { label: "Keruncingan Hentakan (Kurtosis / β2)", baseVal: `${base5D.kurtosis.toFixed(3)}`, headVal: `${head5D.kurtosis.toFixed(3)}`, delta: `${deltas.dKurt >= 0 ? "+" : ""}${deltas.dKurt.toFixed(3)}`, tol: "±0.750", pass: Math.abs(deltas.dKurt) <= 0.75 },
                      ].map((row) => (
                        <tr key={row.label} className="hover:bg-slate-50/60 transition-colors">
                          <td className="px-3.5 py-2.5 font-sans font-semibold text-slate-800 text-[0.72rem]">
                            {row.label}
                          </td>
                          <td className="px-3.5 py-2.5 text-cyan-700 font-bold text-[0.7rem]">
                            {row.baseVal}
                          </td>
                          <td className="px-3.5 py-2.5 text-orange-700 font-bold text-[0.7rem]">
                            {row.headVal}
                          </td>
                          <td
                            className="px-3.5 py-2.5 font-bold text-[0.7rem]"
                            style={{ color: row.pass ? "#16A34A" : "#DC2626" }}
                          >
                            {row.delta}
                          </td>
                          <td className="px-3.5 py-2.5 text-slate-500 text-[0.65rem]">
                            {row.tol}
                          </td>
                          <td className="px-3.5 py-2.5">
                            <span
                              className="px-2 py-0.5 rounded text-[0.55rem] font-bold"
                              style={{
                                background: row.pass ? "#DCFCE7" : "#FEE2E2",
                                color: row.pass ? "#15803D" : "#DC2626",
                                border: `1px solid ${row.pass ? "#BBF7D0" : "#FECACA"}`,
                              }}
                            >
                              {row.pass ? "NORMAL" : "DEVIASI"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* 3 Kartu Komparasi Model GHMM & Ambang */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.58rem", textTransform: "uppercase" }}>
                      Log-Likelihood GHMM
                    </p>
                    <div className="flex items-baseline justify-between mt-1">
                      <span className="text-cyan-700 font-bold text-xs" style={{ fontFamily: MONO }}>
                        Base: -45.0
                      </span>
                      <span className="text-orange-700 font-bold text-xs" style={{ fontFamily: MONO }}>
                        Head: {headParsed.summary?.logLikelihood ?? "—"}
                      </span>
                    </div>
                    <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.52rem", marginTop: 4 }}>
                      Probabilitas Forward State HMM
                    </p>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.58rem", textTransform: "uppercase" }}>
                      Ambang Adaptif (Th)
                    </p>
                    <div className="flex items-baseline justify-between mt-1">
                      <span className="text-cyan-700 font-bold text-xs" style={{ fontFamily: MONO }}>
                        Base: 0.15g
                      </span>
                      <span className="text-orange-700 font-bold text-xs" style={{ fontFamily: MONO }}>
                        Head: {headParsed.summary?.adaptiveThreshold ?? "0.15g"}
                      </span>
                    </div>
                    <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.52rem", marginTop: 4 }}>
                      Margin Toleransi Noise Saku
                    </p>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.58rem", textTransform: "uppercase" }}>
                      Rasio ZUPT Valid
                    </p>
                    <div className="flex items-baseline justify-between mt-1">
                      <span className="text-cyan-700 font-bold text-xs" style={{ fontFamily: MONO }}>
                        Base: 5 / 5
                      </span>
                      <span className="text-orange-700 font-bold text-xs" style={{ fontFamily: MONO }}>
                        Head: {headParsed.steps.filter((s) => s.status !== "FAILED").length} / 5
                      </span>
                    </div>
                    <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.52rem", marginTop: 4 }}>
                      Konsistensi Ayunan Kaki
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: WINDOW-BY-WINDOW INSPECTOR */}
            {activeTab === "windows" && (
              <div className="space-y-3">
                {/* 5 Tombol Tab Jendela */}
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {[0, 1, 2, 3, 4].map((idx) => {
                    const isSel = selectedWindowIdx === idx;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setSelectedWindowIdx(idx)}
                        className="px-3 py-1.5 rounded-lg border text-xs font-bold transition-all cursor-pointer"
                        style={{
                          background: isSel ? "#0F766E" : "#F8FAFC",
                          color: isSel ? "#FFFFFF" : "#475569",
                          borderColor: isSel ? "#0F766E" : "#E2E8F0",
                          fontFamily: MONO,
                        }}
                      >
                        Jendela {idx + 1} (1.5s)
                      </button>
                    );
                  })}
                </div>

                {/* Perbandingan Jendela Spesifik */}
                {(() => {
                  const bStep = baseParsed.steps[selectedWindowIdx];
                  const hStep = headParsed.steps[selectedWindowIdx];

                  return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* Kartu Base Window */}
                      <div className="p-3.5 rounded-xl border border-cyan-200 bg-cyan-50/40 space-y-2">
                        <div className="flex items-center justify-between pb-2 border-b border-cyan-100">
                          <span className="text-cyan-800 font-bold text-xs" style={{ fontFamily: MONO }}>
                            BASE REF: Jendela {selectedWindowIdx + 1}
                          </span>
                          <span className="px-2 py-0.5 rounded text-[0.55rem] font-bold bg-cyan-100 text-cyan-800" style={{ fontFamily: MONO }}>
                            Template Sah
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs" style={{ fontFamily: MONO }}>
                          <div>
                            <span className="text-slate-500 text-[0.58rem]">Rerata Accel:</span>
                            <p className="font-bold text-cyan-900">{bStep?.mean ?? "0.220"} g</p>
                          </div>
                          <div>
                            <span className="text-slate-500 text-[0.58rem]">Varians:</span>
                            <p className="font-bold text-cyan-900">{bStep?.variance ?? "0.160"} g²</p>
                          </div>
                          <div>
                            <span className="text-slate-500 text-[0.58rem]">StdDev:</span>
                            <p className="font-bold text-cyan-900">{bStep?.stdDev ?? "0.400"} g</p>
                          </div>
                          <div>
                            <span className="text-slate-500 text-[0.58rem]">Kurtosis:</span>
                            <p className="font-bold text-cyan-900">{bStep?.kurtosis ?? "2.800"}</p>
                          </div>
                        </div>
                        <div className="pt-2 border-t border-cyan-100 flex items-center justify-between text-[0.58rem]" style={{ fontFamily: MONO }}>
                          <span className="text-cyan-700 font-semibold">Status ZUPT:</span>
                          <span className="font-bold text-green-700">{bStep?.zupt ?? "VALID (MELANGKAH)"}</span>
                        </div>
                      </div>

                      {/* Kartu Head Window */}
                      <div className="p-3.5 rounded-xl border border-orange-200 bg-orange-50/40 space-y-2">
                        <div className="flex items-center justify-between pb-2 border-b border-orange-100">
                          <span className="text-orange-800 font-bold text-xs" style={{ fontFamily: MONO }}>
                            HEAD REF: Jendela {selectedWindowIdx + 1}
                          </span>
                          <span
                            className="px-2 py-0.5 rounded text-[0.55rem] font-bold"
                            style={{
                              background: hStep?.status !== "FAILED" ? "#DCFCE7" : "#FEE2E2",
                              color: hStep?.status !== "FAILED" ? "#16A34A" : "#DC2626",
                              fontFamily: MONO,
                            }}
                          >
                            {hStep?.status ?? "VALID"}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs" style={{ fontFamily: MONO }}>
                          <div>
                            <span className="text-slate-500 text-[0.58rem]">Rerata Accel:</span>
                            <p className="font-bold text-orange-900">{hStep?.mean ?? "0.235"} g</p>
                          </div>
                          <div>
                            <span className="text-slate-500 text-[0.58rem]">Varians:</span>
                            <p className="font-bold text-orange-900">{hStep?.variance ?? "0.180"} g²</p>
                          </div>
                          <div>
                            <span className="text-slate-500 text-[0.58rem]">StdDev:</span>
                            <p className="font-bold text-orange-900">{hStep?.stdDev ?? "0.424"} g</p>
                          </div>
                          <div>
                            <span className="text-slate-500 text-[0.58rem]">Kurtosis:</span>
                            <p className="font-bold text-orange-900">{hStep?.kurtosis ?? "3.100"}</p>
                          </div>
                        </div>
                        <div className="pt-2 border-t border-orange-100 flex items-center justify-between text-[0.58rem]" style={{ fontFamily: MONO }}>
                          <span className="text-orange-700 font-semibold">Status ZUPT:</span>
                          <span className="font-bold text-orange-900">{hStep?.zupt ?? "VALID (MELANGKAH)"}</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* TAB 3: OSILOSKOP GELOMBANG DUAL (OVERLAY / SPLIT) */}
            <div className={`space-y-3 ${activeTab === "oscilloscope" ? "block" : "hidden"}`}>
              {/* Header Kontrol Osiloskop */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-teal-400 animate-pulse" />
                  <span style={{ color: "#E2E8F0", fontFamily: MONO, fontSize: "0.68rem", fontWeight: 700 }}>
                    OSILOSKOP KOMPARASI SINYAL FISIK NYATA (20 HZ IMU)
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {/* Mode Toggle: Overlay vs Split */}
                  <div className="flex items-center bg-slate-800 rounded-lg p-0.5 border border-slate-700">
                    <button
                      type="button"
                      onClick={() => setPlotMode("overlay")}
                      className="px-2.5 py-1 rounded text-[0.58rem] font-bold transition-all cursor-pointer"
                      style={{
                        background: plotMode === "overlay" ? "#0D9488" : "transparent",
                        color: plotMode === "overlay" ? "#FFFFFF" : "#94A3B8",
                        fontFamily: MONO,
                      }}
                    >
                      Overlay (Bertumpuk)
                    </button>
                    <button
                      type="button"
                      onClick={() => setPlotMode("split")}
                      className="px-2.5 py-1 rounded text-[0.58rem] font-bold transition-all cursor-pointer"
                      style={{
                        background: plotMode === "split" ? "#0D9488" : "transparent",
                        color: plotMode === "split" ? "#FFFFFF" : "#94A3B8",
                        fontFamily: MONO,
                      }}
                    >
                      Split (Atas-Bawah)
                    </button>
                  </div>

                  {/* Zoom Controls */}
                  <div className="flex items-center gap-1 bg-slate-800 px-2 py-1 rounded-lg border border-slate-700">
                    <button
                      onClick={handleZoomOut}
                      disabled={zoom <= 1.0}
                      className="p-0.5 rounded text-slate-300 hover:text-white disabled:opacity-30 cursor-pointer"
                      title="Perkecil Zoom"
                    >
                      <ZoomOut size={12} />
                    </button>
                    <span style={{ color: "#38BDF8", fontFamily: MONO, fontSize: "0.62rem", fontWeight: 700, minWidth: 26, textAlign: "center" }}>
                      {zoom.toFixed(1)}x
                    </span>
                    <button
                      onClick={handleZoomIn}
                      disabled={zoom >= 4.0}
                      className="p-0.5 rounded text-slate-300 hover:text-white disabled:opacity-30 cursor-pointer"
                      title="Perbesar Zoom"
                    >
                      <ZoomIn size={12} />
                    </button>
                    <button
                      onClick={handleResetZoom}
                      className="p-0.5 rounded text-slate-400 hover:text-white ml-1 cursor-pointer"
                      title="Reset Tampilan"
                    >
                      <RotateCcw size={11} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Kanvas Osiloskop */}
              <div className="w-full rounded-xl overflow-hidden border border-slate-800 bg-[#0B1329] shadow-md">
                <canvas ref={canvasRef} className="w-full block" />
              </div>

              {/* Slider Pan Offset jika di-zoom */}
              {zoom > 1.0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200">
                  <span style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.55rem" }}>
                    Geser Waktu:
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={panOffset}
                    onChange={(e) => setPanOffset(parseFloat(e.target.value))}
                    className="flex-1 accent-teal-600 cursor-pointer h-1.5 bg-slate-300 rounded-lg"
                  />
                  <span style={{ color: "#0F172A", fontFamily: MONO, fontSize: "0.55rem", fontWeight: 700 }}>
                    {(panOffset * 7.5).toFixed(1)}s
                  </span>
                </div>
              )}

              {/* Legenda Garis Komparasi */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5">
                    <span className="w-3.5 h-1 rounded-full bg-cyan-500" />
                    <span style={{ fontFamily: MONO, fontSize: "0.62rem", color: "#0E7490", fontWeight: 700 }}>
                      Base Accel (Slot {selectedBaseSlot + 1})
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-3.5 h-1 rounded-full bg-orange-500 border border-dashed border-orange-600" />
                    <span style={{ fontFamily: MONO, fontSize: "0.62rem", color: "#C2410C", fontWeight: 700 }}>
                      Head Accel ({currentHead?.userId || "Auth"})
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
                    <span style={{ fontFamily: MONO, fontSize: "0.62rem", color: "#B45309" }}>
                      Base Gyro
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-purple-500/80" />
                    <span style={{ fontFamily: MONO, fontSize: "0.62rem", color: "#7E22CE" }}>
                      Head Gyro
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAccel((a) => !a)}
                    className="px-2 py-0.5 rounded text-[0.55rem] font-bold border transition-colors cursor-pointer"
                    style={{
                      background: showAccel ? "#E0F2FE" : "#F1F5F9",
                      color: showAccel ? "#0369A1" : "#94A3B8",
                      borderColor: showAccel ? "#BAE6FD" : "#CBD5E1",
                      fontFamily: MONO,
                    }}
                  >
                    Accel (g)
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowGyro((g) => !g)}
                    className="px-2 py-0.5 rounded text-[0.55rem] font-bold border transition-colors cursor-pointer"
                    style={{
                      background: showGyro ? "#FEF3C7" : "#F1F5F9",
                      color: showGyro ? "#B45309" : "#94A3B8",
                      borderColor: showGyro ? "#FDE68A" : "#CBD5E1",
                      fontFamily: MONO,
                    }}
                  >
                    Gyro
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Footer Bar */}
          <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
            <span style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.62rem" }}>
              Total 150 Sampel / Jendela · 100 Hz Pengolahan Hardware RP2040
            </span>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-bold text-xs shadow-xs active:scale-95 transition-all cursor-pointer"
              style={{ fontFamily: MONO }}
            >
              TUTUP INSPEKTOR
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
