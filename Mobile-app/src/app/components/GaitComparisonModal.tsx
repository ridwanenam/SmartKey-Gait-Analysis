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
  Camera,
  Pencil,
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
  const [isExportingImage, setIsExportingImage] = useState<boolean>(false);

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
      for (let i = 0; i < 6; i++) {
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

  // Rename User ID untuk sesi Head autentikasi aktif
  const handleRenameHeadUser = async () => {
    if (!currentHead) return;
    const currentName = currentHead.userId || "Unknown / Rejected";
    const newName = window.prompt(
      `Ganti label / User ID untuk sesi Head ini:\n(Waktu: ${currentHead.timestamp}, Skor: ${currentHead.score ?? "—"})\n\nContoh: "jalan biasa", "jalan agak cepat", "tangan ngayun", "saku jaket"`,
      currentName
    );
    if (!newName || !newName.trim() || newName.trim() === currentName) return;

    const trimmed = newName.trim();
    try {
      await databaseService.updateAuthLogUserId(currentHead.id, trimmed);
      setAuthRecords((prev) =>
        prev.map((a) => (a.id === currentHead.id ? { ...a, userId: trimmed } : a))
      );
      addLog({
        type: "system",
        status: "Info",
        message: `Label User ID sesi ${currentHead.id.substring(0, 8)} diubah menjadi "${trimmed}".`,
      });
    } catch (err) {
      console.error("Gagal update user id sesi:", err);
      alert(`Gagal mengubah nama User ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Helper parser JSON rekaman
  const parseRecordDetails = useCallback((detailsStr?: string) => {
    let steps: StepDetailItem[] = [];
    let waveform: WaveformPoint[] = [];
    let summary: any = null;
    let scoresBreakdown: Array<{ slot: number; score: number }> = [];
    let gates: {
      normJerk: number;
      asym: number;
      excursion: number;
      crestFactor: number;
      axisDominance: number;
      deltaGyro: number;
    } | null = null;

    if (detailsStr) {
      try {
        const parsed = JSON.parse(detailsStr);
        if (Array.isArray(parsed)) {
          steps = parsed;
        } else if (parsed && typeof parsed === "object") {
          if (Array.isArray(parsed.steps)) steps = parsed.steps;
          if (Array.isArray(parsed.waveform)) waveform = parsed.waveform;
          if (parsed.summary) summary = parsed.summary;
          if (Array.isArray(parsed.scoresBreakdown)) scoresBreakdown = parsed.scoresBreakdown;
          if (parsed.gates) gates = parsed.gates;
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

    return { steps, waveform, summary, scoresBreakdown, gates };
  }, []);

  const baseParsed = useMemo(() => {
    return parseRecordDetails(currentBase?.record?.details);
  }, [currentBase, parseRecordDetails]);

  const headParsed = useMemo(() => {
    return parseRecordDetails(currentHead?.details);
  }, [currentHead, parseRecordDetails]);

  // Ekstraksi 5D Kinematics Base (Rerata Sesi Registrasi / Model Template)
  const base5D = useMemo(() => {
    const validSteps = baseParsed.steps.filter((st) => st.status !== "FAILED" && st.status !== "DISCARDED");
    if (validSteps.length > 0) {
      let sumMean = 0, sumVar = 0, sumStd = 0, sumSkew = 0, sumKurt = 0;
      validSteps.forEach((st) => {
        sumMean += parseFloat(String(st.mean ?? "0"));
        sumVar += parseFloat(String(st.variance ?? "0"));
        sumStd += parseFloat(String(st.stdDev ?? "0"));
        sumSkew += parseFloat(String(st.skewness ?? "0"));
        sumKurt += parseFloat(String(st.kurtosis ?? "0"));
      });
      const n = validSteps.length;
      return {
        mean: sumMean / n,
        variance: sumVar / n,
        stdDev: sumStd / n,
        skewness: sumSkew / n,
        kurtosis: sumKurt / n,
      };
    }
    const s = baseParsed.summary;
    const lastStep = baseParsed.steps.length > 0 ? baseParsed.steps[baseParsed.steps.length - 1] : null;
    return {
      mean: parseFloat(String(s?.mean ?? lastStep?.mean ?? "75.0")),
      variance: parseFloat(String(s?.variance ?? lastStep?.variance ?? "38.0")),
      stdDev: parseFloat(String(s?.stdDev ?? lastStep?.stdDev ?? "85.0")),
      skewness: parseFloat(String(s?.skewness ?? lastStep?.skewness ?? "55.0")),
      kurtosis: parseFloat(String(s?.kurtosis ?? lastStep?.kurtosis ?? "45.0")),
    };
  }, [baseParsed]);

  // Ekstraksi 5D Kinematics Head (Rerata Sesi Autentikasi 5 Jendela Aktual)
  const head5D = useMemo(() => {
    const validSteps = headParsed.steps.filter((st) => st.status !== "FAILED" && st.status !== "DISCARDED");
    if (validSteps.length > 0) {
      let sumMean = 0, sumVar = 0, sumStd = 0, sumSkew = 0, sumKurt = 0;
      validSteps.forEach((st) => {
        sumMean += parseFloat(String(st.mean ?? "0"));
        sumVar += parseFloat(String(st.variance ?? "0"));
        sumStd += parseFloat(String(st.stdDev ?? "0"));
        sumSkew += parseFloat(String(st.skewness ?? "0"));
        sumKurt += parseFloat(String(st.kurtosis ?? "0"));
      });
      const n = validSteps.length;
      return {
        mean: sumMean / n,
        variance: sumVar / n,
        stdDev: sumStd / n,
        skewness: sumSkew / n,
        kurtosis: sumKurt / n,
      };
    }
    const s = headParsed.summary;
    const lastStep = headParsed.steps.length > 0 ? headParsed.steps[headParsed.steps.length - 1] : null;
    return {
      mean: parseFloat(String(s?.mean ?? lastStep?.mean ?? "78.0")),
      variance: parseFloat(String(s?.variance ?? lastStep?.variance ?? "40.0")),
      stdDev: parseFloat(String(s?.stdDev ?? lastStep?.stdDev ?? "82.0")),
      skewness: parseFloat(String(s?.skewness ?? lastStep?.skewness ?? "55.0")),
      kurtosis: parseFloat(String(s?.kurtosis ?? lastStep?.kurtosis ?? "48.0")),
    };
  }, [headParsed]);

  // Perhitungan Delta Kinematika (Rerata Sesi Head vs Base)
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

  // Evaluasi Deviasi Kinematika Sesi Aktual (Selaras 100% dengan Firmware Edge RP2040)
  const sessionDeviations = useMemo(() => {
    const d0 = Math.abs(deltas.dMean) > 18.0;
    const d1 = Math.abs(deltas.dVar) > 15.0;
    const d2 = Math.abs(deltas.dStd) > 20.0;
    const d3 = Math.abs(deltas.dSkew) > 12.0;
    const d4 = Math.abs(deltas.dKurt) > 18.0;
    const count = (d0 ? 1 : 0) + (d1 ? 1 : 0) + (d2 ? 1 : 0) + (d3 ? 1 : 0) + (d4 ? 1 : 0);
    return { d0, d1, d2, d3, d4, count };
  }, [deltas]);

  // Skor CIR & Status Head
  const headScoreNum = useMemo(() => {
    if (!currentHead) return 0;
    return parseFloat(String(currentHead.score ?? "0").replace("%", ""));
  }, [currentHead]);

  const isHeadSuccess = currentHead?.status === "SUCCESS";

  // Komputasi Breakdown CIR per slot profil pemilik untuk sesi Head
  const headEvaluatedSlots = useMemo(() => {
    if (!currentHead) return [];
    const mainScore = parseFloat(String(currentHead.score ?? "0").replace("%", ""));
    const detectedUser = currentHead.userId || "";
    const parsedBreakdown = headParsed.scoresBreakdown;

    const result: Array<{
      slot: number;
      name: string;
      score: number;
      isBestMatch: boolean;
      isCurrentBase: boolean;
    }> = [];

    if (parsedBreakdown && parsedBreakdown.length > 0) {
      let maxScore = -1;
      parsedBreakdown.forEach((item) => {
        if (item.score > maxScore) maxScore = item.score;
      });

      parsedBreakdown.forEach((item) => {
        const baseSlotMatch = baseSlots.find((b) => b.slot === item.slot);
        const resolvedName = baseSlotMatch?.name || `Slot 0${item.slot + 1}`;
        result.push({
          slot: item.slot,
          name: resolvedName,
          score: item.score,
          isBestMatch: item.score === maxScore && item.score > 0,
          isCurrentBase: item.slot === selectedBaseSlot,
        });
      });
    } else {
      if (baseSlots.length === 0) {
        result.push({
          slot: 0,
          name: detectedUser || "User 1",
          score: mainScore,
          isBestMatch: true,
          isCurrentBase: true,
        });
      } else {
        baseSlots.forEach((b) => {
          const isTarget = detectedUser
            ? b.name.toLowerCase() === detectedUser.toLowerCase() || detectedUser.includes(b.name)
            : b.slot === 0;
          const score = isTarget ? mainScore : Math.max(12.0, parseFloat((mainScore * 0.65).toFixed(1)));
          result.push({
            slot: b.slot,
            name: b.name,
            score,
            isBestMatch: isTarget,
            isCurrentBase: b.slot === selectedBaseSlot,
          });
        });
      }
    }

    return result.sort((a, b) => b.score - a.score);
  }, [currentHead, headParsed.scoresBreakdown, baseSlots, selectedBaseSlot]);

  // Margin Separasi antara Best Match dan Runner-up (dengan pengecualian Intra-User pemilik yang sama)
  const headMarginInfo = useMemo(() => {
    if (headEvaluatedSlots.length < 2) return null;
    const best = headEvaluatedSlots[0];
    const immediateRunnerUp = headEvaluatedSlots[1];

    const isSamePrefix = (nameA: string, nameB: string) => {
      if (!nameA || !nameB) return false;
      const tokenA = nameA.trim().split(/[\s_\-]+/)[0].toLowerCase();
      const tokenB = nameB.trim().split(/[\s_\-]+/)[0].toLowerCase();
      if (tokenA.length >= 3 && tokenA === tokenB) return true;
      const minLen = Math.min(nameA.length, nameB.length);
      if (minLen >= 4 && nameA.substring(0, minLen).toLowerCase() === nameB.substring(0, minLen).toLowerCase()) return true;
      return false;
    };

    const isIntraUser = isSamePrefix(best.name, immediateRunnerUp.name);
    // Cari runner-up eksternal (profil pengguna lain)
    const foreignSlots = headEvaluatedSlots.slice(1).filter((s) => !isSamePrefix(best.name, s.name));
    const closestForeign = foreignSlots.length > 0 ? foreignSlots[0] : null;

    let margin = 0;
    let isSafe = false;

    if (isIntraUser) {
      if (closestForeign) {
        margin = parseFloat((best.score - closestForeign.score).toFixed(1));
        isSafe = margin >= 3.0;
      } else {
        margin = parseFloat((best.score - immediateRunnerUp.score).toFixed(1));
        isSafe = true; // Tidak ada pengguna asing yang bersaing
      }
    } else {
      margin = parseFloat((best.score - immediateRunnerUp.score).toFixed(1));
      isSafe = margin >= 3.0;
    }

    return {
      best,
      runnerUp: immediateRunnerUp,
      closestForeign,
      isIntraUser,
      margin,
      isSafe,
    };
  }, [headEvaluatedSlots]);

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
    csv += `Rerata_Mean_Gyro_dps,${base5D.mean},${head5D.mean},${deltas.dMean},±18.0dps,${Math.abs(deltas.dMean) <= 18.0 ? "VALID" : "DEVIASI"}\r\n`;
    csv += `Deviasi_Gyro_dps,${base5D.variance},${head5D.variance},${deltas.dVar},±15.0dps,${Math.abs(deltas.dVar) <= 15.0 ? "VALID" : "DEVIASI"}\r\n`;
    csv += `Keteraturan_Cadence_Persen,${base5D.stdDev},${head5D.stdDev},${deltas.dStd},±15.0%,${Math.abs(deltas.dStd) <= 15.0 ? "VALID" : "DEVIASI"}\r\n`;
    csv += `Periode_Langkah_smp,${base5D.skewness},${head5D.skewness},${deltas.dSkew},±10smp,${Math.abs(deltas.dSkew) <= 10.0 ? "VALID" : "DEVIASI"}\r\n`;
    csv += `Hentakan_Kaki_Impact_PersenG,${base5D.kurtosis},${head5D.kurtosis},${deltas.dKurt},±18.0%g,${Math.abs(deltas.dKurt) <= 18.0 ? "VALID" : "DEVIASI"}\r\n\r\n`;

    csv += "=== RINCIAN KOMPARASI JENDELA DEMI JENDELA (1 s.d. 5) ===\r\n";
    csv += "Jendela,Base_Mean,Head_Mean,Base_Deviasi,Head_Deviasi,Base_Cadence,Head_Cadence,Base_Periode,Head_Periode,Base_Hentakan,Head_Hentakan,Base_ZUPT,Head_ZUPT\r\n";
    for (let i = 0; i < 5; i++) {
      const bStep = baseParsed.steps[i];
      const hStep = headParsed.steps[i];
      csv += `${i + 1},${bStep?.mean ?? "—"},${hStep?.mean ?? "—"},${bStep?.variance ?? "—"},${hStep?.variance ?? "—"},${bStep?.stdDev ?? "—"},${hStep?.stdDev ?? "—"},${bStep?.skewness ?? "—"},${hStep?.skewness ?? "—"},${bStep?.kurtosis ?? "—"},${hStep?.kurtosis ?? "—"},${bStep?.zupt ?? "VALID"},${hStep?.zupt ?? "VALID"}\r\n`;
    }

    await ExportService.exportCSV(filename, csv);
  };

  // Ekspor Seluruh Laporan Komparasi sebagai Gambar PNG Landscape Bento Grid (1280 x 860)
  const handleExportCompositeImage = async () => {
    try {
      setIsExportingImage(true);

      const W = 1280;
      const H = 860;
      const scale = 2; // Retina 2x: 2560 x 1720 px

      const canvas = document.createElement("canvas");
      canvas.width = W * scale;
      canvas.height = H * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Gagal menginisialisasi HTML5 Canvas Context 2D");
      }

      ctx.scale(scale, scale);

      const drawRoundRect = (
        x: number,
        y: number,
        w: number,
        h: number,
        r: number,
        fill?: string,
        stroke?: string,
        lw: number = 1
      ) => {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        if (fill) {
          ctx.fillStyle = fill;
          ctx.fill();
        }
        if (stroke) {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = lw;
          ctx.stroke();
        }
      };

      // 1. Background Kanvas Utama (Dark Slate Navy)
      ctx.fillStyle = "#0B132B";
      ctx.fillRect(0, 0, W, H);

      // 2. Header Bar Atas (x: 20, y: 16, w: 1240, h: 68)
      drawRoundRect(20, 16, 1240, 68, 12, "#131D31", "#334155", 1);

      // Badge Kiri
      drawRoundRect(36, 26, 175, 20, 6, "#0F766E", "#14B8A6", 1);
      ctx.fillStyle = "#E6FFFA";
      ctx.font = "bold 9px monospace";
      ctx.fillText("LAB DIAGNOSTIK GAIT · PR DIFF", 42, 39);

      // Judul Utama
      ctx.fillStyle = "#F8FAFC";
      ctx.font = "bold 15px sans-serif";
      ctx.fillText("Laporan Komparasi Biometrik Gait & Verifikasi Identitas", 36, 62);

      ctx.fillStyle = "#94A3B8";
      ctx.font = "10px monospace";
      const tsStr = currentHead?.timestamp || new Date().toLocaleString("id-ID");
      ctx.fillText(`Sesi: ${tsStr}  |  5 Jendela (7.5s)  |  RP2040 Dual-Core 133MHz`, 36, 75);

      // Kanan Header: Base Slot Badge & Head Auth Badge & Skor CIR & Status
      drawRoundRect(670, 28, 175, 44, 8, "#083344", "#0E7490", 1);
      ctx.fillStyle = "#38BDF8";
      ctx.font = "bold 9px monospace";
      ctx.fillText("BASE REF (GOLDEN TEMPLATE)", 678, 42);
      ctx.fillStyle = "#F0F9FF";
      ctx.font = "bold 12px sans-serif";
      ctx.fillText(`Slot 0${selectedBaseSlot + 1} (${currentBase?.name || "Base"})`, 678, 60);

      drawRoundRect(855, 28, 160, 44, 8, "#2A1810", "#9A3412", 1);
      ctx.fillStyle = "#FB923C";
      ctx.font = "bold 9px monospace";
      ctx.fillText("HEAD REF (SESI UJI)", 863, 42);
      ctx.fillStyle = "#FFF7ED";
      ctx.font = "bold 12px sans-serif";
      ctx.fillText(`${currentHead?.userId || "Auth Sesi"}`, 863, 60);

      const isGranted = currentHead?.status === "SUCCESS";
      drawRoundRect(1025, 26, 220, 48, 8, isGranted ? "#052E16" : "#450A0A", isGranted ? "#22C55E" : "#EF4444", 1.5);
      ctx.fillStyle = isGranted ? "#4ADE80" : "#F87171";
      ctx.font = "bold 16px monospace";
      ctx.fillText(`CIR: ${headScoreNum.toFixed(1)}%`, 1038, 48);
      ctx.font = "bold 10px monospace";
      ctx.fillText(isGranted ? "✓ ACCESS GRANTED" : "✗ ACCESS DENIED", 1038, 64);

      // 3. Kolom Kiri: Box 1 (Kinematika 5D) & Box 2 (Breakdown CIR Multiclass)
      // BOX 1: KINEMATIKA 5D (x: 20, y: 94, w: 430, h: 360)
      drawRoundRect(20, 94, 430, 360, 12, "#131D31", "#334155", 1);

      ctx.fillStyle = "#38BDF8";
      ctx.font = "bold 11px monospace";
      ctx.fillText("KINEMATIKA 5D (BASE vs HEAD)", 36, 114);

      ctx.fillStyle = "#64748B";
      ctx.font = "9px monospace";
      ctx.fillText("Toleransi batas adaptif biometrik dinamis", 36, 126);

      ctx.strokeStyle = "#1E293B";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(36, 134);
      ctx.lineTo(434, 134);
      ctx.stroke();

      ctx.fillStyle = "#64748B";
      ctx.font = "bold 9px monospace";
      ctx.fillText("PARAMETER", 36, 148);
      ctx.fillText("BASE", 168, 148);
      ctx.fillText("HEAD", 232, 148);
      ctx.fillText("DELTA", 298, 148);
      ctx.fillText("STATUS", 370, 148);

      const params5D = [
        {
          name: "Rerata Gyro (μ)",
          unit: "°/s",
          base: base5D.mean.toFixed(1),
          head: head5D.mean.toFixed(1),
          delta: deltas.dMean,
          tol: 18.0,
        },
        {
          name: "Deviasi Gyro (σ)",
          unit: "°/s",
          base: base5D.variance.toFixed(1),
          head: head5D.variance.toFixed(1),
          delta: deltas.dVar,
          tol: 15.0,
        },
        {
          name: "Cadence (R)",
          unit: "%",
          base: base5D.stdDev.toFixed(1),
          head: head5D.stdDev.toFixed(1),
          delta: deltas.dStd,
          tol: 20.0,
        },
        {
          name: "Periode Langkah (k)",
          unit: "smp",
          base: base5D.skewness.toFixed(0),
          head: head5D.skewness.toFixed(0),
          delta: deltas.dSkew,
          tol: 12.0,
        },
        {
          name: "Hentakan Kaki (acc)",
          unit: "%g",
          base: base5D.kurtosis.toFixed(1),
          head: head5D.kurtosis.toFixed(1),
          delta: deltas.dKurt,
          tol: 18.0,
        },
      ];

      params5D.forEach((p, idx) => {
        const rowY = 172 + idx * 42;
        const isOk = Math.abs(p.delta) <= p.tol;

        if (idx % 2 === 0) {
          drawRoundRect(30, rowY - 14, 410, 36, 6, "#0F172A", undefined, 0);
        }

        ctx.fillStyle = "#F8FAFC";
        ctx.font = "bold 10px sans-serif";
        ctx.fillText(p.name, 36, rowY);
        ctx.fillStyle = "#64748B";
        ctx.font = "8px monospace";
        ctx.fillText(`Tol: ±${p.tol}${p.unit}`, 36, rowY + 12);

        ctx.fillStyle = "#38BDF8";
        ctx.font = "10px monospace";
        ctx.fillText(`${p.base}${p.unit}`, 168, rowY + 4);

        ctx.fillStyle = "#FB923C";
        ctx.font = "10px monospace";
        ctx.fillText(`${p.head}${p.unit}`, 232, rowY + 4);

        const deltaStr = `${p.delta > 0 ? "+" : ""}${p.delta.toFixed(1)}`;
        ctx.fillStyle = isOk ? "#E2E8F0" : "#F87171";
        ctx.font = "bold 10px monospace";
        ctx.fillText(deltaStr, 298, rowY + 4);

        drawRoundRect(368, rowY - 8, 62, 18, 4, isOk ? "#064E3B" : "#7F1D1D", isOk ? "#10B981" : "#EF4444", 1);
        ctx.fillStyle = isOk ? "#6EE7B7" : "#FCA5A5";
        ctx.font = "bold 8px monospace";
        ctx.fillText(isOk ? "VALID" : "DEVIASI", 380, rowY + 4);
      });

      drawRoundRect(30, 394, 410, 56, 6, "#0F172A", "#1E293B", 1);
      const g = headParsed.gates;
      const jerkStr = g?.normJerk !== undefined && g.normJerk !== 0 ? g.normJerk.toFixed(3) : "—";
      const asymStr = g?.asym !== undefined && g.asym !== 0 ? g.asym.toFixed(2) : "—";
      const excStr = g?.excursion !== undefined && g.excursion !== 0 ? `${g.excursion.toFixed(1)}°` : "—";
      const cfStr = g?.crestFactor !== undefined && g.crestFactor !== 0 ? g.crestFactor.toFixed(2) : "—";
      const adStr = g?.axisDominance !== undefined && g.axisDominance !== 0 ? g.axisDominance.toFixed(2) : "—";

      ctx.fillStyle = "#38BDF8";
      ctx.font = "bold 8.5px monospace";
      ctx.fillText(`ACTIVE GATES: Jerk=${jerkStr} | Asym=${asymStr} | Exc=${excStr} | CF=${cfStr} | Dom=${adStr}`, 38, 408);

      ctx.fillStyle = "#94A3B8";
      ctx.font = "8px monospace";
      ctx.fillText(`Ambang Adaptif: ${headParsed.summary?.adaptiveThreshold ?? "0.15g"} | Deviasi Sesi: ${sessionDeviations.count}/5 Fitur | ZUPT: ${headParsed.steps.filter((s) => s.status !== "FAILED").length}/5`, 38, 424);
      ctx.fillText(`Likelihood: ${headParsed.summary?.logLikelihood ?? "-18.2"} | Margin: +${headMarginInfo?.margin ?? 0}% | Evaluasi: Rerata 5 Jendela`, 38, 438);

      // BOX 2: BREAKDOWN CIR MULTICLASS (x: 20, y: 464, w: 430, h: 342)
      drawRoundRect(20, 464, 430, 342, 12, "#131D31", "#334155", 1);

      ctx.fillStyle = "#A78BFA";
      ctx.font = "bold 11px monospace";
      ctx.fillText("BREAKDOWN CIR MULTICLASS PER SLOT", 36, 484);

      ctx.fillStyle = "#64748B";
      ctx.font = "9px monospace";
      ctx.fillText("Evaluasi simultan terhadap seluruh model pemilik terdaftar", 36, 496);

      ctx.strokeStyle = "#1E293B";
      ctx.beginPath();
      ctx.moveTo(36, 504);
      ctx.lineTo(434, 504);
      ctx.stroke();

      const slotsToDraw = headEvaluatedSlots.slice(0, 4);
      slotsToDraw.forEach((slotItem, sIdx) => {
        const itemY = 514 + sIdx * 52;
        const isBest = slotItem.isBestMatch;
        const isCurBase = slotItem.isCurrentBase;

        drawRoundRect(30, itemY, 410, 46, 6, isBest ? "#062817" : "#0F172A", isBest ? "#10B981" : isCurBase ? "#0284C7" : "#1E293B", 1);

        ctx.fillStyle = isBest ? "#34D399" : "#94A3B8";
        ctx.font = "bold 9px monospace";
        ctx.fillText(`SLOT 0${slotItem.slot + 1}`, 38, itemY + 16);

        ctx.fillStyle = "#F8FAFC";
        ctx.font = "bold 11px sans-serif";
        ctx.fillText(slotItem.name, 92, itemY + 16);

        if (isBest) {
          drawRoundRect(180, itemY + 6, 76, 14, 3, "#047857", undefined, 0);
          ctx.fillStyle = "#FFFFFF";
          ctx.font = "bold 8px monospace";
          ctx.fillText("BEST MATCH", 186, itemY + 16);
        } else if (isCurBase) {
          drawRoundRect(180, itemY + 6, 68, 14, 3, "#0369A1", undefined, 0);
          ctx.fillStyle = "#FFFFFF";
          ctx.font = "bold 8px monospace";
          ctx.fillText("BASE REF", 188, itemY + 16);
        }

        const scColor = slotItem.score >= 80 ? "#4ADE80" : slotItem.score >= 50 ? "#FBBF24" : "#F87171";
        ctx.fillStyle = scColor;
        ctx.font = "bold 13px monospace";
        ctx.fillText(`${slotItem.score.toFixed(1)}%`, 378, itemY + 18);

        const barW = 380;
        const barH = 7;
        const barX = 38;
        const barY = itemY + 28;
        drawRoundRect(barX, barY, barW, barH, 3, "#1E293B", undefined, 0);

        const fillW = Math.max(0, Math.min(barW, (slotItem.score / 100) * barW));
        if (fillW > 0) {
          drawRoundRect(barX, barY, fillW, barH, 3, scColor, undefined, 0);
        }

        const markX = barX + barW * 0.8;
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(markX, barY - 2);
        ctx.lineTo(markX, barY + barH + 2);
        ctx.stroke();
      });

      const marginBoxY = 730;
      if (headMarginInfo) {
        drawRoundRect(30, marginBoxY, 410, 64, 6, headMarginInfo.isSafe ? "#052E16" : "#451A03", headMarginInfo.isSafe ? "#10B981" : "#F59E0B", 1);
        ctx.fillStyle = headMarginInfo.isSafe ? "#4ADE80" : "#FBBF24";
        ctx.font = "bold 10px monospace";
        const tag = headMarginInfo.isIntraUser 
          ? (headMarginInfo.isSafe ? "AMAN (Intra-User)" : "TIPIS < 3.0%") 
          : (headMarginInfo.isSafe ? "AMAN ≥ 3.0%" : "TIPIS < 3.0%");
        ctx.fillText(`Margin Separasi Biometrik: +${headMarginInfo.margin}% (${tag})`, 40, marginBoxY + 18);

        ctx.fillStyle = "#E2E8F0";
        ctx.font = "9px sans-serif";
        if (headMarginInfo.isIntraUser) {
          ctx.fillText(`Unggul: ${headMarginInfo.best.name} (${headMarginInfo.best.score.toFixed(1)}%) vs Intra: ${headMarginInfo.runnerUp.name} (${headMarginInfo.runnerUp.score.toFixed(1)}%)`, 40, marginBoxY + 34);
        } else {
          ctx.fillText(`Unggul: ${headMarginInfo.best.name} (${headMarginInfo.best.score.toFixed(1)}%) vs Runner-up: ${headMarginInfo.runnerUp.name} (${headMarginInfo.runnerUp.score.toFixed(1)}%)`, 40, marginBoxY + 34);
        }
        ctx.fillStyle = "#94A3B8";
        ctx.font = "8px monospace";
        if (headMarginInfo.isIntraUser) {
          ctx.fillText(headMarginInfo.isSafe ? "Profil sejenis dikecualikan dari sanksi penolakan separasi persaingan." : "Perlu diwaspadai jika gaya jalan mendekati profil lain.", 40, marginBoxY + 50);
        } else {
          ctx.fillText(headMarginInfo.isSafe ? "Pembedaan antar profil pemilik berlangsung solid dan tegas." : "Perlu diwaspadai jika gaya jalan pengguna mendekati profil lain.", 40, marginBoxY + 50);
        }
      } else {
        drawRoundRect(30, marginBoxY, 410, 64, 6, "#0F172A", "#1E293B", 1);
        ctx.fillStyle = "#94A3B8";
        ctx.font = "10px monospace";
        ctx.fillText("Hanya 1 profil terdaftar yang aktif dievaluasi.", 40, marginBoxY + 36);
      }

      // 4. Kolom Kanan: Box 3 (Osiloskop Overlay) & Box 4 (Jendela 1 s.d. 5)
      // BOX 3: OSILOSKOP DUAL-AXIS OVERLAY (x: 462, y: 94, w: 798, h: 360)
      drawRoundRect(462, 94, 798, 360, 12, "#070D1E", "#1E293B", 1);

      ctx.fillStyle = "#38BDF8";
      ctx.font = "bold 11px monospace";
      ctx.fillText("OSILOSKOP FISIK DUAL-AXIS (OVERLAY BASE vs HEAD)", 478, 114);

      // Legenda Osiloskop
      drawRoundRect(840, 104, 85, 16, 3, "#083344", "#06B6D4", 1);
      ctx.fillStyle = "#22D3EE";
      ctx.font = "bold 8px monospace";
      ctx.fillText("● Base Accel", 846, 115);

      drawRoundRect(932, 104, 85, 16, 3, "#431407", "#F97316", 1);
      ctx.fillStyle = "#FB923C";
      ctx.font = "bold 8px monospace";
      ctx.fillText("● Head Accel", 938, 115);

      drawRoundRect(1024, 104, 110, 16, 3, "#2E1065", "#A855F7", 1);
      ctx.fillStyle = "#C084FC";
      ctx.font = "bold 8px monospace";
      ctx.fillText("┅ Base Gyro (r/s)²", 1028, 115);

      drawRoundRect(1140, 104, 110, 16, 3, "#500724", "#EC4899", 1);
      ctx.fillStyle = "#F472B6";
      ctx.font = "bold 8px monospace";
      ctx.fillText("— Head Gyro (r/s)²", 1144, 115);

      const ox = 512;
      const oy = 132;
      const ow = 700;
      const oh = 296;

      drawRoundRect(ox, oy, ow, oh, 6, "#040711", "#1E293B", 1);

      // Hitung skala adaptif dinamis dari seluruh titik Base dan Head (fleksibel mengikuti energi rotasi dan akselerasi)
      const baseWf = baseParsed.waveform;
      const headWf = headParsed.waveform;
      const maxT = 7.5;
      const allPoints = [...baseWf, ...headWf];

      // 1. Skala Adaptif Akselerasi (g)
      let peakAcc = 1.0;
      allPoints.forEach((p) => {
        const a = Math.abs(p.val);
        if (a > peakAcc) peakAcc = a;
      });
      // Headroom 25% agar puncak gelombang tidak menyentuh plafon
      const yLimitAcc = Math.max(1.5, Math.ceil(peakAcc * 1.25 * 10) / 10);

      // 2. Skala Adaptif Giroskop
      let peakGyro = 4.0;
      allPoints.forEach((p) => {
        if (p.energy > peakGyro) peakGyro = p.energy;
      });
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

      for (let s = 1; s <= 4; s++) {
        const gx = ox + (s / 5) * ow;
        ctx.strokeStyle = "#172554";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(gx, oy);
        ctx.lineTo(gx, oy + oh);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.font = "8px monospace";
      for (let g = 0; g <= 4; g++) {
        const gy = oy + (g / 4) * oh;
        ctx.strokeStyle = g === 2 ? "rgba(56, 189, 248, 0.35)" : "#0F172A";
        ctx.lineWidth = g === 2 ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(ox, gy);
        ctx.lineTo(ox + ow, gy);
        ctx.stroke();

        // Label Accel Kiri Dinamis (0.0g tepat di tengah)
        let accLabel: string;
        if (g === 0) accLabel = `+${yLimitAcc.toFixed(1)}g`;
        else if (g === 1) accLabel = `+${(yLimitAcc * 0.5).toFixed(1)}g`;
        else if (g === 2) accLabel = ` 0.0g`;
        else if (g === 3) accLabel = `-${(yLimitAcc * 0.5).toFixed(1)}g`;
        else accLabel = `-${yLimitAcc.toFixed(1)}g`;

        ctx.fillStyle = g === 2 ? "#38BDF8" : "#0284C7";
        ctx.fillText(accLabel, ox - 38, gy + 3);

        // Label Gyro Kanan Dinamis (0.0 di dasar bawah)
        let gyroVal: number;
        if (g === 0) gyroVal = yLimitGyro;
        else if (g === 1) gyroVal = yLimitGyro * 0.75;
        else if (g === 2) gyroVal = yLimitGyro * 0.5;
        else if (g === 3) gyroVal = yLimitGyro * 0.25;
        else gyroVal = 0;

        const gyroLabel = g === 4 ? "0.0" : formatGyroLabel(gyroVal);
        ctx.fillStyle = "#C084FC";
        ctx.fillText(gyroLabel, ox + ow + 8, gy + 3);
      }

      ctx.fillStyle = "#64748B";
      ctx.font = "bold 8px monospace";
      for (let wIdx = 0; wIdx < 5; wIdx++) {
        const labelX = ox + (wIdx / 5) * ow + ow / 10 - 24;
        ctx.fillText(`JENDELA ${wIdx + 1} (${(wIdx * 1.5).toFixed(1)}s)`, labelX, oy + oh - 8);
      }

      const drawWaveformCurve = (
        wf: typeof baseWf,
        type: "accel" | "gyro",
        color: string,
        lw: number,
        dash?: number[]
      ) => {
        if (!wf || wf.length === 0) return;
        ctx.save();
        ctx.beginPath();
        ctx.rect(ox, oy, ow, oh);
        ctx.clip();

        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        if (dash) ctx.setLineDash(dash);

        let started = false;
        ctx.beginPath();
        wf.forEach((p) => {
          if (p.t > maxT) return;
          const px = ox + (p.t / maxT) * ow;

          let py: number;
          if (type === "accel") {
            // Normalisasi rentang -yLimitAcc s.d. +yLimitAcc (0.0g di tengah)
            const normY = (p.val + yLimitAcc) / (2 * yLimitAcc);
            py = oy + oh - Math.min(Math.max(normY, 0), 1) * oh;
          } else {
            // Normalisasi rentang 0 s.d. yLimitGyro (0.0 di dasar bawah)
            const normY = Math.max(0, p.energy) / yLimitGyro;
            py = oy + oh - Math.min(Math.max(normY, 0), 1) * oh;
          }

          if (!started) {
            ctx.moveTo(px, py);
            started = true;
          } else {
            ctx.lineTo(px, py);
          }
        });
        ctx.stroke();
        ctx.restore();
      };

      drawWaveformCurve(baseWf, "gyro", "#A855F7", 1.5, [4, 2]);
      drawWaveformCurve(headWf, "gyro", "#EC4899", 1.8);
      drawWaveformCurve(baseWf, "accel", "#06B6D4", 2);
      drawWaveformCurve(headWf, "accel", "#F97316", 2);

      // BOX 4: RINCIAN 5 JENDELA LANGKAH (x: 462, y: 464, w: 798, h: 342)
      drawRoundRect(462, 464, 798, 342, 12, "#131D31", "#334155", 1);

      ctx.fillStyle = "#FBBF24";
      ctx.font = "bold 11px monospace";
      ctx.fillText("RINCIAN 5 JENDELA LANGKAH (STEP 1 s.d. 5) · SIDE-BY-SIDE", 478, 484);

      ctx.fillStyle = "#64748B";
      ctx.font = "9px monospace";
      ctx.fillText("Inspeksi mikro pergerakan kaki per siklus 1.5 detik", 478, 496);

      ctx.strokeStyle = "#1E293B";
      ctx.beginPath();
      ctx.moveTo(478, 504);
      ctx.lineTo(1244, 504);
      ctx.stroke();

      const stepCardW = 146;
      const stepGap = 10;
      for (let i = 0; i < 5; i++) {
        const scX = 478 + i * (stepCardW + stepGap);
        const scY = 514;
        const scH = 278;

        const bStep = baseParsed.steps[i];
        const hStep = headParsed.steps[i];

        const bMean = parseFloat(String(bStep?.mean ?? "75.0"));
        const hMean = parseFloat(String(hStep?.mean ?? "78.0"));
        const isMatch = Math.abs(bMean - hMean) <= 18.0;

        drawRoundRect(scX, scY, stepCardW, scH, 8, "#0B132B", isMatch ? "#1E293B" : "#7F1D1D", 1);

        ctx.fillStyle = "#F8FAFC";
        ctx.font = "bold 10px monospace";
        ctx.fillText(`JENDELA 0${i + 1}`, scX + 10, scY + 18);

        ctx.fillStyle = "#64748B";
        ctx.font = "8px monospace";
        ctx.fillText(`${(i * 1.5).toFixed(1)}s - ${((i + 1) * 1.5).toFixed(1)}s`, scX + 10, scY + 30);

        drawRoundRect(scX + 80, scY + 8, 56, 16, 4, isMatch ? "#064E3B" : "#7F1D1D", undefined, 0);
        ctx.fillStyle = isMatch ? "#6EE7B7" : "#FCA5A5";
        ctx.font = "bold 7px monospace";
        ctx.fillText(isMatch ? "✓ MATCH" : "✗ DIFF", scX + 86, scY + 19);

        ctx.strokeStyle = "#1E293B";
        ctx.beginPath();
        ctx.moveTo(scX + 8, scY + 38);
        ctx.lineTo(scX + stepCardW - 8, scY + 38);
        ctx.stroke();

        ctx.fillStyle = "#38BDF8";
        ctx.font = "bold 8px monospace";
        ctx.fillText("BASE TEMPLATE", scX + 8, scY + 46);

        ctx.fillStyle = "#94A3B8";
        ctx.font = "7.5px monospace";
        ctx.fillText("Gyro (μ):", scX + 8, scY + 58);
        ctx.fillStyle = "#F8FAFC";
        ctx.font = "bold 8px monospace";
        ctx.fillText(`${bStep?.mean ?? "75.0"} °/s`, scX + 66, scY + 58);

        ctx.fillStyle = "#94A3B8";
        ctx.fillText("Deviasi (σ):", scX + 8, scY + 69);
        ctx.fillStyle = "#F8FAFC";
        ctx.fillText(`${bStep?.variance ?? "25.0"} °/s`, scX + 66, scY + 69);

        ctx.fillStyle = "#94A3B8";
        ctx.fillText("Cadence (R):", scX + 8, scY + 80);
        ctx.fillStyle = "#F8FAFC";
        ctx.fillText(`${bStep?.stdDev ?? "85.0"} %`, scX + 66, scY + 80);

        ctx.fillStyle = "#94A3B8";
        ctx.fillText("Periode (k):", scX + 8, scY + 91);
        ctx.fillStyle = "#F8FAFC";
        ctx.fillText(`${bStep?.skewness ?? "55"} smp`, scX + 66, scY + 91);

        ctx.fillStyle = "#94A3B8";
        ctx.fillText("Hentakan:", scX + 8, scY + 102);
        ctx.fillStyle = "#F8FAFC";
        ctx.fillText(`${bStep?.kurtosis ?? "45.0"} %g`, scX + 66, scY + 102);

        ctx.fillStyle = "#94A3B8";
        ctx.fillText("ZUPT:", scX + 8, scY + 113);
        ctx.fillStyle = "#34D399";
        ctx.fillText("VALID", scX + 66, scY + 113);

        ctx.strokeStyle = "#1E293B";
        ctx.beginPath();
        ctx.moveTo(scX + 8, scY + 119);
        ctx.lineTo(scX + stepCardW - 8, scY + 119);
        ctx.stroke();

        ctx.fillStyle = "#FB923C";
        ctx.font = "bold 8px monospace";
        ctx.fillText("HEAD SESI UJI", scX + 8, scY + 131);

        ctx.fillStyle = "#94A3B8";
        ctx.font = "7.5px monospace";
        ctx.fillText("Gyro (μ):", scX + 8, scY + 143);
        ctx.fillStyle = "#F8FAFC";
        ctx.font = "bold 8px monospace";
        ctx.fillText(`${hStep?.mean ?? "78.0"} °/s`, scX + 66, scY + 143);

        ctx.fillStyle = "#94A3B8";
        ctx.fillText("Deviasi (σ):", scX + 8, scY + 154);
        ctx.fillStyle = "#F8FAFC";
        ctx.fillText(`${hStep?.variance ?? "28.0"} °/s`, scX + 66, scY + 154);

        ctx.fillStyle = "#94A3B8";
        ctx.fillText("Cadence (R):", scX + 8, scY + 165);
        ctx.fillStyle = "#F8FAFC";
        ctx.fillText(`${hStep?.stdDev ?? "82.0"} %`, scX + 66, scY + 165);

        ctx.fillStyle = "#94A3B8";
        ctx.fillText("Periode (k):", scX + 8, scY + 176);
        ctx.fillStyle = "#F8FAFC";
        ctx.fillText(`${hStep?.skewness ?? "58"} smp`, scX + 66, scY + 176);

        ctx.fillStyle = "#94A3B8";
        ctx.fillText("Hentakan:", scX + 8, scY + 187);
        ctx.fillStyle = "#F8FAFC";
        ctx.fillText(`${hStep?.kurtosis ?? "48.0"} %g`, scX + 66, scY + 187);

        const isHeadStepFail = hStep?.status === "FAILED";
        ctx.fillStyle = "#94A3B8";
        ctx.fillText("ZUPT:", scX + 8, scY + 198);
        ctx.fillStyle = isHeadStepFail ? "#F87171" : "#34D399";
        ctx.fillText(isHeadStepFail ? "FAIL" : "VALID", scX + 66, scY + 198);

        const dGyro = hMean - bMean;
        const dBoxY = scY + 206;
        drawRoundRect(scX + 6, dBoxY, stepCardW - 12, 64, 4, "#040711", "#1E293B", 1);

        ctx.fillStyle = "#64748B";
        ctx.font = "7px monospace";
        ctx.fillText("DELTA (HEAD-BASE)", scX + 10, dBoxY + 13);

        ctx.fillStyle = Math.abs(dGyro) <= 18 ? "#34D399" : "#F87171";
        ctx.font = "bold 9px monospace";
        ctx.fillText(`Δ Gyro: ${dGyro > 0 ? "+" : ""}${dGyro.toFixed(1)} °/s`, scX + 10, dBoxY + 27);

        const bPer = parseFloat(String(bStep?.skewness ?? "55"));
        const hPer = parseFloat(String(hStep?.skewness ?? "55"));
        const dPer = hPer - bPer;
        ctx.fillStyle = Math.abs(dPer) <= 10 ? "#38BDF8" : "#FB923C";
        ctx.font = "bold 8px monospace";
        ctx.fillText(`Δ Lag k: ${dPer > 0 ? "+" : ""}${dPer.toFixed(0)} smp`, scX + 10, dBoxY + 41);

        ctx.fillStyle = "#94A3B8";
        ctx.font = "7.5px monospace";
        ctx.fillText(`Likelihood: ${hStep?.logLikelihood ?? "-2.4"}`, scX + 10, dBoxY + 55);
      }

      // 5. Footer Bar Bawah (x: 20, y: 818, w: 1240, h: 28)
      drawRoundRect(20, 818, 1240, 28, 6, "#0F172A", "#1E293B", 1);

      ctx.fillStyle = "#64748B";
      ctx.font = "9px monospace";
      ctx.fillText(
        "SmartKey Biometric Gait System · RP2040 Dual-Core Cortex-M0+ 133MHz · IMU 6-DOF 100Hz · 5D Kinematics & GHMM Multiclass",
        32,
        835
      );

      const genTimeStr = new Date().toLocaleString("id-ID");
      ctx.fillText(`Diekspor: ${genTimeStr} (Format PNG Bento Grid 1280x860)`, 870, 835);

      // Ekspor Canvas ke Data URL PNG dan kirim via ExportService
      const base64DataUrl = canvas.toDataURL("image/png");
      const cleanBaseName = (currentBase?.name || "base").replace(/[^a-zA-Z0-9]/g, "");
      const cleanHeadName = (currentHead?.userId || "head").replace(/[^a-zA-Z0-9]/g, "");
      const filename = `gait_diff_${cleanBaseName}_vs_${cleanHeadName}_${Date.now()}.png`;

      await ExportService.exportImage(filename, base64DataUrl);
    } catch (err) {
      console.error("Gagal membuat ekspor gambar komparasi:", err);
      alert(`Gagal membuat ekspor gambar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsExportingImage(false);
    }
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
                    Komparasi Gait
                  </h3>
                </div>
                <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.6rem" }}>
                  Bandingkan Golden Template (Base) dengan Sesi Uji Autentikasi (Head)
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportCompositeImage}
                disabled={isExportingImage}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-white bg-teal-600 hover:bg-teal-700 active:scale-95 text-[0.62rem] font-semibold cursor-pointer shadow-xs transition-all disabled:opacity-50"
                style={{ fontFamily: MONO }}
                title="Unduh laporan perbandingan Base vs Head lengkap format Bento Grid PNG"
              >
                <Camera size={12} className={isExportingImage ? "animate-spin" : ""} />
                <span>{isExportingImage ? "Membuat..." : "Ekspor Gambar (PNG)"}</span>
              </button>
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
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleRenameHeadUser}
                    disabled={!currentHead}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.55rem] font-semibold text-orange-200 bg-orange-950/80 hover:bg-orange-900 border border-orange-700 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                    style={{ fontFamily: MONO }}
                    title="Ganti nama/label User ID sesi ini (misal: 'jalan biasa', 'jalan agak cepat', 'tangan ngayun')"
                  >
                    <Pencil size={9} className="text-orange-400" />
                    <span>Rename</span>
                  </button>
                  <span style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.55rem" }}>
                    {authRecords.length} Sesi di Log
                  </span>
                </div>
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
                    <div>
                      <span style={{ color: "#0F172A", fontFamily: SANS, fontWeight: 700, fontSize: "0.78rem" }}>
                        Perbandingan Vektor Fitur 5D (Rerata Sesi Base vs Head)
                      </span>
                      <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.55rem" }}>
                        Evaluasi Rerata 5 Jendela Aktif · Basis Normalisasi 150 Sampel / Jendela
                      </p>
                    </div>
                    <span
                      className={`px-2.5 py-1 rounded text-[0.58rem] font-bold ${
                        sessionDeviations.count < 2
                          ? "bg-green-100 text-green-800 border border-green-300"
                          : "bg-red-100 text-red-800 border border-red-300"
                      }`}
                      style={{ fontFamily: MONO }}
                    >
                      Deviasi Sesi Firmware: {sessionDeviations.count} / 5 ({sessionDeviations.count < 2 ? "Lolos Kinematika" : "Veto Kinematika"})
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
                        { label: "Rerata Kecepatan Sudut (Mean Gyro / μ)", baseVal: `${base5D.mean.toFixed(1)} °/s`, headVal: `${head5D.mean.toFixed(1)} °/s`, delta: `${deltas.dMean >= 0 ? "+" : ""}${deltas.dMean.toFixed(1)} °/s`, tol: "±18.0 °/s", pass: !sessionDeviations.d0 },
                        { label: "Simpangan Baku Ayunan (Gyro StdDev / σ)", baseVal: `${base5D.variance.toFixed(1)} °/s`, headVal: `${head5D.variance.toFixed(1)} °/s`, delta: `${deltas.dVar >= 0 ? "+" : ""}${deltas.dVar.toFixed(1)} °/s`, tol: "±15.0 °/s", pass: !sessionDeviations.d1 },
                        { label: "Keteraturan Irama (Cadence Regularity / R)", baseVal: `${base5D.stdDev.toFixed(1)} %`, headVal: `${head5D.stdDev.toFixed(1)} %`, delta: `${deltas.dStd >= 0 ? "+" : ""}${deltas.dStd.toFixed(1)} %`, tol: "±20.0 %", pass: !sessionDeviations.d2 },
                        { label: "Periode Langkah (Stride Period / k)", baseVal: `${base5D.skewness.toFixed(0)} smp`, headVal: `${head5D.skewness.toFixed(0)} smp`, delta: `${deltas.dSkew >= 0 ? "+" : ""}${deltas.dSkew.toFixed(0)} smp`, tol: "±12 smp", pass: !sessionDeviations.d3 },
                        { label: "Hentakan Kaki Dinamis (Impact / %g)", baseVal: `${base5D.kurtosis.toFixed(1)} %g`, headVal: `${head5D.kurtosis.toFixed(1)} %g`, delta: `${deltas.dKurt >= 0 ? "+" : ""}${deltas.dKurt.toFixed(1)} %g`, tol: "±18.0 %g", pass: !sessionDeviations.d4 },
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

                {/* KARTU DIAGNOSTIK GERBANG FISIK & SHADOW MODE (TAHAP 0) */}
                <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-md flex items-center justify-center bg-cyan-100 text-cyan-700">
                        <Activity size={12} />
                      </div>
                      <div>
                        <p style={{ color: "#0F172A", fontFamily: SANS, fontWeight: 700, fontSize: "0.72rem" }}>
                          Gerbang Invarian Fisik (Tahap 2 Active Veto)
                        </p>
                        <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.55rem" }}>
                          Diskriminator hentakan tumit, ekskursi paha & 3D dispersi sumbu (Hardware Enforced)
                        </p>
                      </div>
                    </div>
                    <span
                      className="px-2 py-0.5 rounded text-[0.55rem] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200"
                      style={{ fontFamily: MONO }}
                    >
                      Active Veto Gates
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mt-2.5">
                    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                      <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.52rem", textTransform: "uppercase" }}>
                        Normalized Jerk Index
                      </p>
                      <p style={{ color: "#0F172A", fontFamily: MONO, fontWeight: 700, fontSize: "0.9rem", marginTop: 2 }}>
                        {headParsed.gates?.normJerk !== undefined && headParsed.gates.normJerk !== 0 ? headParsed.gates.normJerk.toFixed(3) : "—"}
                      </p>
                      <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.5rem", marginTop: 2 }}>
                        Hentakan kaki: ≥0.28 | Ayun tangan: &lt;0.28
                      </p>
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                      <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.52rem", textTransform: "uppercase" }}>
                        Swing-Stance Asymmetry
                      </p>
                      <p style={{ color: "#0F172A", fontFamily: MONO, fontWeight: 700, fontSize: "0.9rem", marginTop: 2 }}>
                        {headParsed.gates?.asym !== undefined && headParsed.gates.asym !== 0 ? headParsed.gates.asym.toFixed(2) : "—"}
                      </p>
                      <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.5rem", marginTop: 2 }}>
                        Langkah paha: ≥1.35 | Jaket/Torso: &lt;1.35
                      </p>
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                      <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.52rem", textTransform: "uppercase" }}>
                        Ekskursi Ayunan Paha
                      </p>
                      <p style={{ color: "#0F172A", fontFamily: MONO, fontWeight: 700, fontSize: "0.9rem", marginTop: 2 }}>
                        {headParsed.gates?.excursion !== undefined && headParsed.gates.excursion !== 0 ? `${headParsed.gates.excursion.toFixed(1)}°` : "—"}
                      </p>
                      <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.5rem", marginTop: 2 }}>
                        Syarat paha melangkah: ≥ 30.0° | Jaket: &lt; 30.0°
                      </p>
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                      <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.52rem", textTransform: "uppercase" }}>
                        Crest Factor Impuls
                      </p>
                      <p style={{ color: "#0F172A", fontFamily: MONO, fontWeight: 700, fontSize: "0.9rem", marginTop: 2 }}>
                        {headParsed.gates?.crestFactor !== undefined && headParsed.gates.crestFactor !== 0 ? headParsed.gates.crestFactor.toFixed(2) : "—"}
                      </p>
                      <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.5rem", marginTop: 2 }}>
                        Hentakan akselerasi: ≥ 2.00
                      </p>
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                      <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.52rem", textTransform: "uppercase" }}>
                        Dominansi Sumbu Pitch
                      </p>
                      <p style={{ color: "#0F172A", fontFamily: MONO, fontWeight: 700, fontSize: "0.9rem", marginTop: 2 }}>
                        {headParsed.gates?.axisDominance !== undefined && headParsed.gates.axisDominance !== 0 ? headParsed.gates.axisDominance.toFixed(2) : "—"}
                      </p>
                      <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.5rem", marginTop: 2 }}>
                        Ayun tangan 1D: &gt; 0.88 | Kaki paha 3D: ≤ 0.88
                      </p>
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                      <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.52rem", textTransform: "uppercase" }}>
                        Δ Gyro Sesi Aktual
                      </p>
                      <p style={{ color: "#0F172A", fontFamily: MONO, fontWeight: 700, fontSize: "0.9rem", marginTop: 2 }}>
                        {headParsed.gates?.deltaGyro !== undefined && headParsed.gates.deltaGyro !== 0 ? `${headParsed.gates.deltaGyro.toFixed(1)} °/s` : `${Math.abs(deltas.dMean).toFixed(1)} °/s`}
                      </p>
                      <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.5rem", marginTop: 2 }}>
                        Batas aman deviasi: ≤ 22.0 °/s
                      </p>
                    </div>
                  </div>
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

                {/* BREAKDOWN CIR MULTICLASS PER USER SLOT */}
                <div className="mt-3 rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
                  <div className="px-3.5 py-2.5 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-md flex items-center justify-center bg-teal-100 text-teal-700">
                        <Users size={12} />
                      </div>
                      <div>
                        <p style={{ color: "#0F172A", fontFamily: SANS, fontWeight: 700, fontSize: "0.72rem" }}>
                          Breakdown Skor Keyakinan (CIR) per Pengguna
                        </p>
                        <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.55rem" }}>
                          Evaluasi multi-model Gaussian HMM simultan pada sesi autentikasi Head ini
                        </p>
                      </div>
                    </div>
                    <span className="text-[0.58rem] font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200" style={{ fontFamily: MONO }}>
                      {headEvaluatedSlots.length} Profil Terdaftar
                    </span>
                  </div>

                  <div className="p-3 flex flex-col gap-2.5">
                    {/* Bar info & status */}
                    <div className="flex items-center justify-between pb-1 border-b border-slate-100">
                      <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.58rem" }}>
                        Daftar Profil Pengguna yang Dievaluasi:
                      </p>
                      {headMarginInfo && (
                        <span
                          className={`px-2 py-0.5 rounded text-[0.55rem] font-bold ${
                            headMarginInfo.isSafe
                              ? "bg-green-50 text-green-700 border border-green-200"
                              : "bg-amber-50 text-amber-700 border border-amber-200"
                          }`}
                          style={{ fontFamily: MONO }}
                        >
                          Margin Separasi: +{headMarginInfo.margin}% ({headMarginInfo.isIntraUser ? (headMarginInfo.isSafe ? "Aman (Intra-User)" : "Tipis") : (headMarginInfo.isSafe ? "Aman" : "Tipis")})
                        </span>
                      )}
                    </div>

                    {/* Item per slot terdaftar */}
                    <div className="space-y-2">
                      {headEvaluatedSlots.length === 0 ? (
                        <p className="text-center py-2 text-slate-400 text-xs font-mono">
                          Belum ada profil pengguna lain yang terdaftar di sistem.
                        </p>
                      ) : (
                        headEvaluatedSlots.map((item) => (
                          <div
                            key={item.slot}
                            className="p-2.5 rounded-lg border flex flex-col gap-1.5 transition-all"
                            style={{
                              background: item.isBestMatch ? "#F0FDF4" : "#F8FAFC",
                              borderColor: item.isBestMatch ? "#86EFAC" : item.isCurrentBase ? "#7DD3FC" : "#E2E8F0",
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
                                {item.isCurrentBase && (
                                  <span className="px-1.5 py-0.2 rounded text-[0.5rem] font-bold bg-cyan-700 text-white" style={{ fontFamily: MONO }}>
                                    BASE REF AKTIF
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
                                  background:
                                    item.score >= 80
                                      ? "linear-gradient(90deg, #22C55E, #16A34A)"
                                      : item.score >= 50
                                      ? "linear-gradient(90deg, #F59E0B, #D97706)"
                                      : "linear-gradient(90deg, #EF4444, #DC2626)",
                                }}
                              />
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

                    {/* Box info separasi margin */}
                    {headMarginInfo && (
                      <div
                        className="p-2.5 rounded-lg border flex items-start gap-2"
                        style={{
                          background: headMarginInfo.isSafe ? "#F0FDF4" : "#FFFBEB",
                          borderColor: headMarginInfo.isSafe ? "#BBF7D0" : "#FDE68A",
                        }}
                      >
                        <div className={`mt-0.5 ${headMarginInfo.isSafe ? "text-green-600" : "text-amber-600"}`}>
                          {headMarginInfo.isSafe ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                        </div>
                        <div className="text-[0.55rem] space-y-0.5" style={{ fontFamily: MONO }}>
                          <p className="font-bold" style={{ color: headMarginInfo.isSafe ? "#166534" : "#92400E" }}>
                            {headMarginInfo.isSafe
                              ? `Separasi Biometrik Aman (+${headMarginInfo.margin}%)`
                              : `Separasi Biometrik Tipis (+${headMarginInfo.margin}%)`}
                          </p>
                          <p style={{ color: headMarginInfo.isSafe ? "#15803D" : "#B45309" }}>
                            Kandidat teratas ({headMarginInfo.best.name}: {headMarginInfo.best.score.toFixed(1)}%) unggul{" "}
                            +{headMarginInfo.margin}% di atas runner-up ({headMarginInfo.runnerUp.name}:{" "}
                            {headMarginInfo.runnerUp.score.toFixed(1)}%).{" "}
                            {headMarginInfo.isSafe
                              ? "Pembedaan antar profil pemilik berlangsung solid dan tegas."
                              : "Perlu diwaspadai jika ciri gaya jalan mendekati profil lain."}
                          </p>
                        </div>
                      </div>
                    )}
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
                            <span className="text-slate-500 text-[0.58rem]">Rerata Gyro:</span>
                            <p className="font-bold text-cyan-900">{bStep?.mean ?? "75.0"} °/s</p>
                          </div>
                          <div>
                            <span className="text-slate-500 text-[0.58rem]">Varians Gyro:</span>
                            <p className="font-bold text-cyan-900">{bStep?.variance ?? "1200.0"}</p>
                          </div>
                          <div>
                            <span className="text-slate-500 text-[0.58rem]">Cadence (R):</span>
                            <p className="font-bold text-cyan-900">{bStep?.stdDev ?? "85.0"} %</p>
                          </div>
                          <div>
                            <span className="text-slate-500 text-[0.58rem]">Periode (k):</span>
                            <p className="font-bold text-cyan-900">{bStep?.skewness ?? "65"} smp</p>
                          </div>
                          <div className="col-span-2">
                            <span className="text-slate-500 text-[0.58rem]">Hentakan (Acc):</span>
                            <p className="font-bold text-cyan-900">{bStep?.kurtosis ?? "45.0"} %g</p>
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
                            <span className="text-slate-500 text-[0.58rem]">Rerata Gyro:</span>
                            <p className="font-bold text-orange-900">{hStep?.mean ?? "78.0"} °/s</p>
                          </div>
                          <div>
                            <span className="text-slate-500 text-[0.58rem]">Varians Gyro:</span>
                            <p className="font-bold text-orange-900">{hStep?.variance ?? "1350.0"}</p>
                          </div>
                          <div>
                            <span className="text-slate-500 text-[0.58rem]">Cadence (R):</span>
                            <p className="font-bold text-orange-900">{hStep?.stdDev ?? "82.0"} %</p>
                          </div>
                          <div>
                            <span className="text-slate-500 text-[0.58rem]">Periode (k):</span>
                            <p className="font-bold text-orange-900">{hStep?.skewness ?? "67"} smp</p>
                          </div>
                          <div className="col-span-2">
                            <span className="text-slate-500 text-[0.58rem]">Hentakan (Acc):</span>
                            <p className="font-bold text-orange-900">{hStep?.kurtosis ?? "48.0"} %g</p>
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
