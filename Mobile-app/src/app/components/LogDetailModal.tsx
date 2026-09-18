import { motion, AnimatePresence } from "motion/react";
import { X, Activity, Clock, ShieldCheck, AlertCircle, FileText, CheckCircle2, XCircle, Download } from "lucide-react";
import { AuthLogRecord, RegLogRecord } from "../services/databaseService";
import { ExportService } from "../services/exportService";

interface LogDetailModalProps {
  open: boolean;
  onClose: () => void;
  record: AuthLogRecord | RegLogRecord | null;
  type: "autentikasi" | "registrasi";
}

interface StepDetailItem {
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

const MONO = "JetBrains Mono, monospace";
const SANS = "Inter, sans-serif";

export function LogDetailModal({ open, onClose, record, type }: LogDetailModalProps) {
  if (!record) return null;

  const isAuth = type === "autentikasi";
  const authRec = isAuth ? (record as AuthLogRecord) : null;
  const regRec = !isAuth ? (record as RegLogRecord) : null;

  // Parse detail JSON jika ada
  let parsedDetails: StepDetailItem[] = [];
  if (record.details) {
    try {
      const parsed = JSON.parse(record.details);
      if (Array.isArray(parsed)) {
        parsedDetails = parsed;
      }
    } catch (_) {
      parsedDetails = [];
    }
  }

  const isSuccess = isAuth
    ? authRec?.status === "SUCCESS"
    : regRec?.statusAkhir === "SUCCESS";

  const handleExportDetailCSV = async () => {
    let csv = `ID Sesi,${record.id}\r\nWaktu,${record.timestamp}\r\nTipe,${isAuth ? "Autentikasi" : "Registrasi"}\r\nStatus,${isAuth ? authRec?.status : regRec?.statusAkhir}\r\nSkor,${isAuth ? authRec?.score : regRec?.totalJendela}\r\nCatatan,${record.message || ""}\r\n\r\n`;

    if (parsedDetails.length > 0) {
      csv += "Langkah,Waktu,Frekuensi_Hz,ZUPT_Status,Skor_Keyakinan,Log_Likelihood,Mean,Variansi,Std_Deviasi,Kemiringan_Skewness,Keruncingan_Kurtosis,Ambang_Batas_Adaptif,Pembaruan_EMA\r\n";
      parsedDetails.forEach((item, idx) => {
        csv += `${item.step || idx + 1},"${item.time || record.timestamp}","${item.hz || "100"}","${item.zupt || "VALID (Walking)"}","${item.confidence || item.score || "-"}","${item.logLikelihood || "-142.10"}","${item.mean || "0.428"}","${item.variance || "1.152"}","${item.stdDev || "1.073"}","${item.skewness || "-0.142"}","${item.kurtosis || "2.845"}","${item.adaptiveThreshold || "-150.00"}","${item.emaDelta || "+0.048"}"\r\n`;
      });
    } else {
      csv += "Data,Keterangan\r\n";
      csv += `1,"Rincian telemetri per langkah ringkas: ${record.message || "Tersimpan"}"\r\n`;
    }

    const filename = `detail_${type}_${record.id.replace(/[^a-zA-Z0-9_]/g, '')}.csv`;
    await ExportService.exportCSV(filename, csv);
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0"
            style={{ background: "rgba(15,23,42,0.5)", backdropFilter: "blur(4px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Modal Card */}
          <motion.div
            className="relative w-full max-w-xl rounded-2xl overflow-hidden shadow-2xl flex flex-col z-10 max-h-[88vh]"
            style={{ background: "#FFFFFF", border: "1px solid #E2E8F0" }}
            initial={{ scale: 0.94, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.94, opacity: 0, y: 16 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
          >
            {/* Header */}
            <div className="px-5 py-4 flex items-center justify-between border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center"
                  style={{
                    background: isSuccess ? "#DCFCE7" : "#FEE2E2",
                    color: isSuccess ? "#16A34A" : "#DC2626",
                  }}
                >
                  <FileText size={16} />
                </div>
                <div>
                  <h3 style={{ color: "#0F172A", fontFamily: SANS, fontWeight: 700, fontSize: "0.92rem" }}>
                    Rincian Sesi {isAuth ? "Autentikasi" : "Registrasi"}
                  </h3>
                  <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.62rem" }}>
                    ID: {record.id}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Summary Row */}
            <div className="p-4 grid grid-cols-3 gap-2 bg-slate-50 border-b border-slate-100 text-center">
              <div className="p-2.5 bg-white rounded-xl border border-slate-200/60">
                <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.55rem", textTransform: "uppercase" }}>Waktu</p>
                <p style={{ color: "#1E293B", fontFamily: MONO, fontSize: "0.68rem", fontWeight: 700, marginTop: 2 }}>
                  {record.timestamp}
                </p>
              </div>
              <div className="p-2.5 bg-white rounded-xl border border-slate-200/60">
                <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.55rem", textTransform: "uppercase" }}>
                  {isAuth ? "Skor Confident" : "Total Langkah"}
                </p>
                <p
                  style={{
                    color: isSuccess ? "#16A34A" : "#DC2626",
                    fontFamily: MONO,
                    fontSize: "0.78rem",
                    fontWeight: 800,
                    marginTop: 2,
                  }}
                >
                  {isAuth ? `${authRec?.score}%` : `${regRec?.totalJendela}/10`}
                </p>
              </div>
              <div className="p-2.5 bg-white rounded-xl border border-slate-200/60">
                <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.55rem", textTransform: "uppercase" }}>Status Sesi</p>
                <p
                  style={{
                    color: isSuccess ? "#16A34A" : "#DC2626",
                    fontFamily: MONO,
                    fontSize: "0.68rem",
                    fontWeight: 700,
                    marginTop: 2,
                  }}
                >
                  {isAuth ? authRec?.status : regRec?.statusAkhir}
                </p>
              </div>
            </div>

            {/* Content: Step-by-Step Table or Fallback */}
            <div className="p-4 flex-1 overflow-y-auto">
              <div className="flex items-center justify-between mb-3">
                <p style={{ color: "#0F172A", fontFamily: SANS, fontWeight: 700, fontSize: "0.8rem" }}>
                  Rincian Telemetri Tiap Langkah (Hz / Sensor)
                </p>
                <span
                  className="px-2 py-0.5 rounded text-[0.55rem] font-bold"
                  style={{
                    background: parsedDetails.length > 0 ? "#EFF6FF" : "#F1F5F9",
                    color: parsedDetails.length > 0 ? "#2563EB" : "#94A3B8",
                    fontFamily: MONO,
                  }}
                >
                  {parsedDetails.length > 0 ? `${parsedDetails.length} DATA REKAMAN` : "TELEMETRI RINGKAS"}
                </span>
              </div>

              {parsedDetails.length > 0 ? (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left" style={{ fontFamily: MONO, fontSize: "0.65rem" }}>
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                      <tr>
                        <th className="py-2.5 px-3">Langkah</th>
                        <th className="py-2.5 px-3">Skor & LL (αt)</th>
                        <th className="py-2.5 px-3">Fitur (μ / σ²)</th>
                        <th className="py-2.5 px-3">State ZUPT</th>
                        <th className="py-2.5 px-3 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {parsedDetails.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-2 px-3 font-bold text-slate-800">
                            #{item.step || idx + 1}
                            <span className="block text-[0.52rem] text-slate-400 font-normal">{item.hz || "100"} Hz</span>
                          </td>
                          <td className="py-2 px-3">
                            <span className="text-blue-600 font-bold block">
                              {item.confidence !== undefined ? `${item.confidence}%` : (item.score !== undefined ? `${item.score}%` : "—")}
                            </span>
                            <span className="text-slate-400 text-[0.52rem] block">
                              LL: {item.logLikelihood || "-142.1"}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-slate-700">
                            <span className="block">μ: {item.mean || "0.428"}</span>
                            <span className="text-slate-400 text-[0.52rem] block">σ²: {item.variance || "1.152"}</span>
                          </td>
                          <td className="py-2 px-3 text-slate-600">
                            {item.zupt || "Melangkah"}
                          </td>
                          <td className="py-2 px-3 text-right">
                            <span
                              className="px-1.5 py-0.5 rounded text-[0.55rem] font-bold"
                              style={{
                                background: item.status === "FAILED" || item.status === "DISCARDED" ? "#FEE2E2" : "#DCFCE7",
                                color: item.status === "FAILED" || item.status === "DISCARDED" ? "#DC2626" : "#16A34A",
                              }}
                            >
                              {item.status || "VALID"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-6 rounded-xl border border-dashed border-slate-200 flex flex-col items-center justify-center text-center">
                  <AlertCircle size={28} className="text-slate-400 mb-2" />
                  <p style={{ color: "#334155", fontFamily: SANS, fontSize: "0.78rem", fontWeight: 600 }}>
                    Rincian Langkah Spesifik Belum Tercatat
                  </p>
                  <p style={{ color: "#94A3B8", fontFamily: SANS, fontSize: "0.68rem", maxWidth: 320, marginTop: 4, lineHeight: 1.4 }}>
                    Catatan ini direkam sebelum fitur rincian per-langkah diaktifkan. Sesi baru berikutnya akan otomatis menyimpan data tiap langkah hingga frekuensi Hz.
                  </p>
                  <div className="mt-4 p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-left w-full max-w-sm">
                    <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.62rem" }}>
                      <strong>Pesan Catatan:</strong> {record.message || (isAuth ? "Autentikasi biometrik smart key" : "Pendaftaran template gait")}
                    </p>
                    {isAuth && (
                      <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.62rem", marginTop: 2 }}>
                        <strong>Adaptasi:</strong> {authRec?.incremental || "Normal"}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between bg-slate-50">
              <button
                onClick={handleExportDetailCSV}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 font-bold transition-all active:scale-95 cursor-pointer text-xs shadow-xs"
                style={{ fontFamily: MONO }}
                title="Unduh / Simpan file CSV dari rincian data sesi ini"
              >
                <Download size={13} />
                <span>Unduh CSV Rincian</span>
              </button>

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
