import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Download, Activity, HardDrive, Wifi, Trash2, RefreshCw } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { useBLE } from "../context/BLEContext";
import {
  databaseService,
  AuthLogRecord,
  RegLogRecord,
  SystemLogRecord,
  DebugMLLogRecord,
} from "../services/databaseService";

type TabType = "autentikasi" | "registrasi" | "sistem" | "debug";

const MONO = "JetBrains Mono, monospace";
const SANS = "Inter, sans-serif";
const TEAL = "#00F0A0";
const TEAL_DIM = "#0D9488";

const GYRO_X_COLOR = "#00C896";
const GYRO_Y_COLOR = "#2563EB";
const GYRO_Z_COLOR = "#F59E0B";

const MAX_GYRO_POINTS = 32;

const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: { color: string; name: string; value: number }[] }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10, padding: "6px 10px", fontFamily: MONO, fontSize: "0.6rem", boxShadow: "0 4px 12px rgba(15,23,42,0.1)" }}>
      {payload.map((p) => (
        <div key={p.name} style={{ color: p.color, display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontWeight: 700, textTransform: "uppercase" }}>{p.name}:</span>
          <span>{p.value.toFixed(3)}</span>
        </div>
      ))}
    </div>
  );
};

interface LogSheetProps {
  open: boolean;
  onClose: () => void;
}

export function LogSheet({ open, onClose }: LogSheetProps) {
  const { bleData, connectionState } = useBLE();
  const [tab, setTab] = useState<TabType>("autentikasi");

  // State log dari SQLite
  const [authLogs, setAuthLogs] = useState<AuthLogRecord[]>([]);
  const [regLogs, setRegLogs] = useState<RegLogRecord[]>([]);
  const [systemLogs, setSystemLogs] = useState<SystemLogRecord[]>([]);
  const [debugLogs, setDebugLogs] = useState<DebugMLLogRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Real-time gyro state
  const [gyroData, setGyroData] = useState<{ t: number, x: number, y: number, z: number }[]>(
    Array.from({ length: MAX_GYRO_POINTS }, (_, i) => ({ t: i, x: 0, y: 0, z: 0 }))
  );
  const gyroT = useRef(MAX_GYRO_POINTS);

  // Fungsi memuat data dari SQLite
  const loadLogsFromSQLite = useCallback(async () => {
    setIsLoading(true);
    try {
      if (tab === "autentikasi") {
        const data = await databaseService.getAuthLogs();
        setAuthLogs(data);
      } else if (tab === "registrasi") {
        const data = await databaseService.getRegLogs();
        setRegLogs(data);
      } else if (tab === "sistem") {
        const data = await databaseService.getSystemLogs();
        setSystemLogs(data);
      } else if (tab === "debug") {
        const data = await databaseService.getDebugMLLogs();
        setDebugLogs(data);
      }
    } catch (err) {
      console.error("Gagal membaca log dari SQLite:", err);
    } finally {
      setIsLoading(false);
    }
  }, [tab]);

  // Muat data saat sheet terbuka atau ganti tab
  useEffect(() => {
    if (open) {
      loadLogsFromSQLite();
    }
  }, [open, tab, loadLogsFromSQLite]);

  // Handle stream data gyro saat tab debug dibuka
  useEffect(() => {
    if (open && tab === "debug") {
      let x = 0, y = 0, z = 0;
      if (connectionState === "connected" && bleData.vector !== "-") {
        try {
          const parsed = JSON.parse(bleData.vector);
          if (Array.isArray(parsed) && parsed.length === 3) {
            x = parsed[0]; y = parsed[1]; z = parsed[2];
          }
        } catch (e) { }
      }

      const t = gyroT.current++;
      setGyroData((prev) => {
        const next = [...prev, { t, x, y, z }];
        return next.slice(-MAX_GYRO_POINTS);
      });
    }
  }, [bleData.vector, connectionState, open, tab]);

  // Hapus log dari SQLite
  const handleClearLogs = async () => {
    if (confirm(`Apakah Anda yakin ingin menghapus seluruh ${tab === "autentikasi" ? "Log Autentikasi" : tab === "registrasi" ? "Log Registrasi" : tab === "sistem" ? "Log Sistem" : "Log Debug ML"} dari SQLite?`)) {
      await databaseService.clearLogs(tab);
      await loadLogsFromSQLite();
    }
  };

  // Unduh CSV dari data SQLite aktual
  const downloadCSV = () => {
    let csv = "";
    if (tab === "autentikasi") {
      csv = "No,Waktu,User ID,Skor Confident,Status,Catatan\n";
      authLogs.forEach((r, i) => {
        csv += `${i + 1},"${r.timestamp}","${r.userId}","${r.score}","${r.status}","${r.message || ''}"\n`;
      });
    } else if (tab === "registrasi") {
      csv = "No,Waktu,Slot User,Total Jendela,Status Akhir,Pesan\n";
      regLogs.forEach((r, i) => {
        csv += `${i + 1},"${r.timestamp}","${r.slotUser}","${r.totalJendela}/10","${r.statusAkhir}","${r.message || ''}"\n`;
      });
    } else if (tab === "sistem") {
      csv = "No,Waktu,Status,Pesan\n";
      systemLogs.forEach((r, i) => {
        csv += `${i + 1},"${r.timestamp}","${r.status}","${r.message}"\n`;
      });
    } else {
      csv = "No,Waktu,Vector,Sigma,ZUPT,GHMM,Threshold,Alpha,DW,Freq\n";
      debugLogs.forEach((r, i) => {
        csv += `${i + 1},"${r.timestamp}","${r.vector}","${r.sigma}","${r.zupt}","${r.ghmm}","${r.th}","${r.alpha}","${r.dw}","${r.freq}"\n`;
      });
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sqlite_log_${tab}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40"
            style={{ background: "rgba(30,41,59,0.45)", backdropFilter: "blur(3px)" }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed bottom-0 left-0 right-0 md:bottom-6 md:left-1/2 md:-translate-x-1/2 md:max-w-3xl md:w-full z-50 rounded-t-3xl md:rounded-2xl overflow-hidden flex flex-col"
            style={{ background: "#FFFFFF", boxShadow: "0 -8px 40px rgba(30,41,59,0.18)", maxHeight: "90dvh" }}
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
          >
            {/* Grab handle */}
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-10 h-1 rounded-full" style={{ background: "#CBD5E1" }} />
            </div>

            {/* Header */}
            <div className="px-4 pt-2 pb-3 shrink-0" style={{ borderBottom: "1px solid #F1F5F9" }}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p style={{ color: "#1E293B", fontFamily: SANS, fontWeight: 700, fontSize: "0.9rem" }}>
                      Riwayat Log Lokal (SQLite)
                    </p>
                    <span
                      className="px-1.5 py-0.5 rounded text-[0.55rem] font-bold"
                      style={{ background: "#EFF6FF", color: "#2563EB", border: "1px solid #BFDBFE", fontFamily: MONO }}
                    >
                      PERSISTEN
                    </span>
                  </div>
                  <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.6rem", marginTop: 1 }}>
                    Database Internal: smart_gait_lock_db
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="w-7 h-7 rounded-full flex items-center justify-center"
                  style={{ background: "#F1F5F9", color: "#64748B" }}
                >
                  <X size={14} />
                </button>
              </div>

              {/* 4 Tabs */}
              <div className="flex p-1.5 rounded-xl gap-1 overflow-x-auto" style={{ background: "#F1F5F9" }}>
                {[
                  { id: "autentikasi", label: "Log Autentikasi", color: "#2563EB" },
                  { id: "registrasi", label: "Log Registrasi", color: "#16A34A" },
                  { id: "sistem", label: "Log Sistem", color: "#7C3AED" },
                  { id: "debug", label: "Log Debug ML & Isyarat", color: TEAL_DIM },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id as TabType)}
                    className="flex-1 py-2 px-3 rounded-lg text-center transition-all shrink-0"
                    style={{
                      background: tab === t.id ? "#FFFFFF" : "transparent",
                      boxShadow: tab === t.id ? "0 1px 4px rgba(30,41,59,0.1)" : "none",
                      color: tab === t.id ? t.color : "#94A3B8",
                      fontFamily: MONO,
                      fontSize: "0.6rem",
                      fontWeight: tab === t.id ? 700 : 500,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Actions Bar (Refresh, Clear, Download CSV) */}
            <div className="px-5 py-2.5 flex items-center justify-between" style={{ borderBottom: "1px solid #EEF2F7" }}>
              <div className="flex items-center gap-2">
                <button
                  onClick={loadLogsFromSQLite}
                  disabled={isLoading}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-slate-600 active:scale-95 text-[0.62rem]"
                  style={{ background: "#FFFFFF", borderColor: "#E2E8F0", fontFamily: MONO }}
                  title="Muat Ulang dari SQLite"
                >
                  <RefreshCw size={11} className={isLoading ? "animate-spin" : ""} />
                  <span>Refresh</span>
                </button>
                <button
                  onClick={handleClearLogs}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-red-600 active:scale-95 text-[0.62rem]"
                  style={{ background: "#FEF2F2", borderColor: "#FECACA", fontFamily: MONO }}
                  title="Hapus Log di Tab Ini"
                >
                  <Trash2 size={11} />
                  <span>Hapus</span>
                </button>
              </div>

              <button
                onClick={downloadCSV}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all active:scale-95"
                style={{ background: "#F8FAFC", border: "1px solid #E2E8F0" }}
              >
                <Download size={12} style={{ color: "#64748B" }} />
                <span style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.62rem", fontWeight: 700 }}>
                  Unduh CSV
                </span>
              </button>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto bg-white">
              <AnimatePresence mode="wait">
                {/* 1. TAB AUTENTIKASI */}
                {tab === "autentikasi" && (
                  <table className="w-full text-left" style={{ fontFamily: MONO, borderCollapse: "collapse" }}>
                    <thead className="sticky top-0 z-10" style={{ background: "#FAFAFA", boxShadow: "0 1px 0 #EEF2F7" }}>
                      <tr>
                        {["No", "Waktu", "User ID", "Skor", "Status", "Pesan"].map((h) => (
                          <th key={h} className="px-3 py-2.5" style={{ color: "#94A3B8", fontSize: "0.58rem", fontWeight: 600, textTransform: "uppercase" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {authLogs.map((r, i) => (
                        <tr key={r.id || i} className="hover:bg-slate-50 transition-colors" style={{ borderBottom: "1px solid #F8FAFC" }}>
                          <td className="px-3 py-2.5" style={{ color: "#94A3B8", fontSize: "0.62rem" }}>
                            {(i + 1).toString().padStart(2, "0")}
                          </td>
                          <td className="px-3 py-2.5" style={{ color: "#64748B", fontSize: "0.62rem" }}>
                            {r.timestamp}
                          </td>
                          <td className="px-3 py-2.5" style={{ color: "#1E293B", fontSize: "0.62rem", fontWeight: 600 }}>
                            {r.userId}
                          </td>
                          <td className="px-3 py-2.5" style={{ color: "#2563EB", fontSize: "0.62rem", fontWeight: 700 }}>
                            {r.score}
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className="px-2 py-0.5 rounded-md text-[0.58rem] font-bold inline-block"
                              style={{
                                background: r.status === "SUCCESS" ? "#F0FDF4" : "#FEF2F2",
                                color: r.status === "SUCCESS" ? "#16A34A" : "#DC2626",
                                border: `1px solid ${r.status === "SUCCESS" ? "#BBF7D0" : "#FECACA"}`,
                              }}
                            >
                              {r.status}
                            </span>
                          </td>
                          <td className="px-3 py-2.5" style={{ color: "#64748B", fontSize: "0.6rem" }}>
                            {r.message || "-"}
                          </td>
                        </tr>
                      ))}
                      {authLogs.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center" style={{ color: "#94A3B8", fontSize: "0.65rem" }}>
                            Belum ada riwayat autentikasi di database SQLite.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}

                {/* 2. TAB REGISTRASI */}
                {tab === "registrasi" && (
                  <table className="w-full text-left" style={{ fontFamily: MONO, borderCollapse: "collapse" }}>
                    <thead className="sticky top-0 z-10" style={{ background: "#FAFAFA", boxShadow: "0 1px 0 #EEF2F7" }}>
                      <tr>
                        {["No", "Waktu", "Slot User", "Jendela Valid", "Status", "Pesan"].map((h) => (
                          <th key={h} className="px-3 py-2.5" style={{ color: "#94A3B8", fontSize: "0.58rem", fontWeight: 600, textTransform: "uppercase" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {regLogs.map((r, i) => (
                        <tr key={r.id || i} className="hover:bg-slate-50 transition-colors" style={{ borderBottom: "1px solid #F8FAFC" }}>
                          <td className="px-3 py-2.5" style={{ color: "#94A3B8", fontSize: "0.62rem" }}>
                            {(i + 1).toString().padStart(2, "0")}
                          </td>
                          <td className="px-3 py-2.5" style={{ color: "#64748B", fontSize: "0.62rem" }}>
                            {r.timestamp}
                          </td>
                          <td className="px-3 py-2.5" style={{ color: "#1E293B", fontSize: "0.62rem", fontWeight: 600 }}>
                            {r.slotUser}
                          </td>
                          <td className="px-3 py-2.5" style={{ color: "#16A34A", fontSize: "0.62rem", fontWeight: 700 }}>
                            {r.totalJendela} / 10
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className="px-2 py-0.5 rounded-md text-[0.58rem] font-bold inline-block"
                              style={{
                                background: r.statusAkhir === "SUCCESS" ? "#F0FDF4" : "#FEF2F2",
                                color: r.statusAkhir === "SUCCESS" ? "#16A34A" : "#DC2626",
                                border: `1px solid ${r.statusAkhir === "SUCCESS" ? "#BBF7D0" : "#FECACA"}`,
                              }}
                            >
                              {r.statusAkhir}
                            </span>
                          </td>
                          <td className="px-3 py-2.5" style={{ color: "#64748B", fontSize: "0.6rem" }}>
                            {r.message || "-"}
                          </td>
                        </tr>
                      ))}
                      {regLogs.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center" style={{ color: "#94A3B8", fontSize: "0.65rem" }}>
                            Belum ada riwayat registrasi di database SQLite.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}

                {/* 3. TAB SISTEM */}
                {tab === "sistem" && (
                  <table className="w-full text-left" style={{ fontFamily: MONO, borderCollapse: "collapse" }}>
                    <thead className="sticky top-0 z-10" style={{ background: "#FAFAFA", boxShadow: "0 1px 0 #EEF2F7" }}>
                      <tr>
                        {["No", "Waktu", "Status", "Pesan"].map((h) => (
                          <th key={h} className="px-4 py-2.5" style={{ color: "#94A3B8", fontSize: "0.58rem", fontWeight: 600, textTransform: "uppercase" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {systemLogs.map((r, i) => (
                        <tr key={r.id || i} className="hover:bg-slate-50 transition-colors" style={{ borderBottom: "1px solid #F8FAFC" }}>
                          <td className="px-4 py-2.5" style={{ color: "#94A3B8", fontSize: "0.62rem" }}>
                            {(i + 1).toString().padStart(2, "0")}
                          </td>
                          <td className="px-4 py-2.5" style={{ color: "#64748B", fontSize: "0.62rem" }}>
                            {r.timestamp}
                          </td>
                          <td className="px-4 py-2.5">
                            <span
                              className="px-2 py-0.5 rounded-md text-[0.58rem] font-bold inline-block"
                              style={{
                                background: r.status === "Success" ? "#F0FDF4" : r.status === "Info" ? "#F0F9FF" : "#FEF2F2",
                                color: r.status === "Success" ? "#16A34A" : r.status === "Info" ? "#0EA5E9" : "#DC2626",
                                border: `1px solid ${r.status === "Success" ? "#BBF7D0" : r.status === "Info" ? "#BAE6FD" : "#FECACA"}`,
                              }}
                            >
                              {r.status}
                            </span>
                          </td>
                          <td className="px-4 py-2.5" style={{ color: "#1E293B", fontSize: "0.62rem" }}>
                            {r.message}
                          </td>
                        </tr>
                      ))}
                      {systemLogs.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-4 py-8 text-center" style={{ color: "#94A3B8", fontSize: "0.65rem" }}>
                            Belum ada riwayat sistem di database SQLite.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}

                {/* 4. TAB DEBUG ML & ISYARAT */}
                {tab === "debug" && (
                  <motion.div
                    key="debug"
                    className="px-4 py-4 flex flex-col gap-4"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    transition={{ duration: 0.14 }}
                  >
                    {/* Gyro Real-Time Chart */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <Activity size={13} style={{ color: TEAL_DIM }} />
                          <p style={{ color: "#1E293B", fontFamily: SANS, fontWeight: 700, fontSize: "0.78rem" }}>
                            Isyarat Gyroscope Real-Time
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          {[
                            { label: "X-Axis", color: GYRO_X_COLOR },
                            { label: "Y-Axis", color: GYRO_Y_COLOR },
                            { label: "Z-Axis", color: GYRO_Z_COLOR },
                          ].map((l) => (
                            <div key={l.label} className="flex items-center gap-1">
                              <div className="w-4 h-0.5 rounded-full" style={{ background: l.color }} />
                              <span style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.56rem" }}>{l.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.56rem", marginBottom: 8 }}>
                        Post-Kalman Filter · Buffer: {MAX_GYRO_POINTS} titik · Arduino Nano RP2040
                      </p>

                      <div
                        className="rounded-xl overflow-hidden"
                        style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", height: 150 }}
                      >
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={gyroData} margin={{ top: 10, right: 12, left: -20, bottom: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                            <XAxis dataKey="t" tick={false} axisLine={false} tickLine={false} />
                            <YAxis
                              domain={[-2, 2]}
                              tick={{ fill: "#94A3B8", fontSize: 9, fontFamily: MONO }}
                              axisLine={false}
                              tickLine={false}
                              tickCount={5}
                            />
                            <Tooltip content={<CustomTooltip />} />
                            <Line
                              type="monotone"
                              dataKey="x"
                              name="X"
                              stroke={GYRO_X_COLOR}
                              strokeWidth={2}
                              dot={false}
                              isAnimationActive={false}
                            />
                            <Line
                              type="monotone"
                              dataKey="y"
                              name="Y"
                              stroke={GYRO_Y_COLOR}
                              strokeWidth={2}
                              dot={false}
                              isAnimationActive={false}
                            />
                            <Line
                              type="monotone"
                              dataKey="z"
                              name="Z"
                              stroke={GYRO_Z_COLOR}
                              strokeWidth={1.5}
                              dot={false}
                              isAnimationActive={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Telemetry Grid */}
                    <div>
                      <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.56rem", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
                        Telemetri Algoritma Terbaru
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { key: "Noise Kalman Filter", value: `Sigma: ${bleData.telemetry.sigma}`, color: GYRO_X_COLOR },
                          { key: "Status Window ZUPT", value: bleData.telemetry.zupt, color: "#16A34A" },
                          { key: "Skor Log-Likelihood GHMM", value: bleData.telemetry.ghmm, color: GYRO_Y_COLOR },
                          { key: "Batas Ambang Dinamis", value: `Th: ${bleData.telemetry.th} m/s²`, color: "#D97706" },
                          { key: "Delta Personalisasi EMA", value: `α: ${bleData.telemetry.alpha} | ΔW: ${bleData.telemetry.dw}`, color: TEAL_DIM },
                          { key: "Frekuensi Sampling BLE", value: bleData.telemetry.freq, color: "#7C3AED" },
                        ].map(({ key, value, color }) => (
                          <div
                            key={key}
                            className="rounded-xl p-3"
                            style={{ background: "#F8FAFC", border: "1px solid #F1F5F9" }}
                          >
                            <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.54rem", textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.3 }}>
                              {key}
                            </p>
                            <p className="mt-1" style={{ color, fontFamily: MONO, fontSize: "0.68rem", fontWeight: 700, lineHeight: 1.2 }}>
                              {value}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* SQLite Storage Status */}
                    <div
                      className="rounded-xl p-3 flex items-center gap-3"
                      style={{ background: "#F0FFFB", border: "1px solid #A7F3D0" }}
                    >
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: "#CCFBF1", border: "1px solid #99F6E4" }}
                      >
                        <HardDrive size={15} style={{ color: TEAL_DIM }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: TEAL }} />
                          <p style={{ color: "#0D9488", fontFamily: MONO, fontSize: "0.62rem", fontWeight: 700 }}>
                            Penyimpanan SQLite: Tersinkron
                          </p>
                        </div>
                        <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.56rem", lineHeight: 1.4 }}>
                          Data tersimpan ke tabel <code>log_debug_ml</code> di database lokal smartphone.
                        </p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <Wifi size={10} style={{ color: TEAL_DIM }} />
                          <span style={{ color: "#0D9488", fontFamily: MONO, fontSize: "0.58rem", fontWeight: 600 }}>
                            {debugLogs.length} sampel telemetri tercatat di SQLite
                          </span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Bottom safe area */}
            <div className="h-5 shrink-0" />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
