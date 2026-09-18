import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Download, Trash2, RefreshCw, Eye } from "lucide-react";
import {
  databaseService,
  AuthLogRecord,
  RegLogRecord,
  SystemLogRecord,
} from "../services/databaseService";
import { LogDetailModal } from "./LogDetailModal";
import { ExportService } from "../services/exportService";

type TabType = "autentikasi" | "registrasi" | "sistem";

const MONO = "JetBrains Mono, monospace";
const SANS = "Inter, sans-serif";

interface LogSheetProps {
  open: boolean;
  onClose: () => void;
}

export function LogSheet({ open, onClose }: LogSheetProps) {
  const [tab, setTab] = useState<TabType>("autentikasi");

  // State log dari SQLite
  const [authLogs, setAuthLogs] = useState<AuthLogRecord[]>([]);
  const [regLogs, setRegLogs] = useState<RegLogRecord[]>([]);
  const [systemLogs, setSystemLogs] = useState<SystemLogRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // State Checkbox Multi-selection
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // State Detail Modal
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<AuthLogRecord | RegLogRecord | null>(null);
  const [selectedType, setSelectedType] = useState<"autentikasi" | "registrasi">("autentikasi");

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
      }
      setSelectedIds([]);
    } catch (err) {
      console.error("Gagal membaca log dari SQLite:", err);
    } finally {
      // Feedback animasi refresh terlihat jelas
      setTimeout(() => setIsLoading(false), 250);
    }
  }, [tab]);

  // Muat data saat sheet terbuka atau ganti tab
  useEffect(() => {
    if (open) {
      loadLogsFromSQLite();
    }
  }, [open, tab, loadLogsFromSQLite]);

  // Ganti tab & reset pilihan
  const handleTabChange = (newTab: TabType) => {
    setTab(newTab);
    setSelectedIds([]);
  };

  // Checkbox Selection Helpers
  const currentLogs = tab === "autentikasi" ? authLogs : tab === "registrasi" ? regLogs : systemLogs;
  const currentIds = currentLogs.map((l) => l.id);
  const isAllSelected = currentIds.length > 0 && currentIds.every((id) => selectedIds.includes(id));
  const isSomeSelected = selectedIds.length > 0;

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(currentIds);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  // Hapus log dari SQLite (Bisa batch terpilih atau hapus semua)
  const handleDeleteLogs = async () => {
    const tabName = tab === "autentikasi" ? "Log Autentikasi" : tab === "registrasi" ? "Log Registrasi" : "Log Sistem";

    if (isSomeSelected) {
      if (confirm(`Apakah Anda yakin ingin menghapus ${selectedIds.length} data terpilih dari ${tabName}?`)) {
        await databaseService.deleteLogsByIds(tab, selectedIds);
        setSelectedIds([]);
        await loadLogsFromSQLite();
      }
    } else {
      if (confirm(`Apakah Anda yakin ingin menghapus SELURUH ${tabName} dari database SQLite?`)) {
        await databaseService.clearLogs(tab);
        setSelectedIds([]);
        await loadLogsFromSQLite();
      }
    }
  };

  // Unduh CSV dari data SQLite aktual (Mendukung Android Native & Web)
  const downloadCSV = async () => {
    let csv = "";
    const dateStr = new Date().toISOString().split("T")[0];
    const filename = `smartkey_log_${tab}_${dateStr}.csv`;

    if (tab === "autentikasi") {
      csv = "No,Waktu,User ID,Skor Confident,Status,Catatan\r\n";
      const logsToExport = isSomeSelected ? authLogs.filter((r) => selectedIds.includes(r.id)) : authLogs;
      logsToExport.forEach((r, i) => {
        csv += `${i + 1},"${r.timestamp}","${r.userId}","${r.score}","${r.status}","${r.message || ''}"\r\n`;
      });
    } else if (tab === "registrasi") {
      csv = "No,Waktu,Slot User,Total Langkah,Status Akhir,Pesan\r\n";
      const logsToExport = isSomeSelected ? regLogs.filter((r) => selectedIds.includes(r.id)) : regLogs;
      logsToExport.forEach((r, i) => {
        csv += `${i + 1},"${r.timestamp}","${r.slotUser}","${r.totalJendela}/10","${r.statusAkhir}","${r.message || ''}"\r\n`;
      });
    } else if (tab === "sistem") {
      csv = "No,Waktu,Status,Pesan\r\n";
      const logsToExport = isSomeSelected ? systemLogs.filter((r) => selectedIds.includes(r.id)) : systemLogs;
      logsToExport.forEach((r, i) => {
        csv += `${i + 1},"${r.timestamp}","${r.status}","${r.message}"\r\n`;
      });
    }

    await ExportService.exportCSV(filename, csv);
  };

  const openDetail = (rec: AuthLogRecord | RegLogRecord, type: "autentikasi" | "registrasi") => {
    setSelectedRecord(rec);
    setSelectedType(type);
    setDetailModalOpen(true);
  };

  return (
    <>
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
                    className="w-7 h-7 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-colors cursor-pointer"
                    style={{ background: "#F1F5F9" }}
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* 3 Tabs Bersih */}
                <div className="flex p-1.5 rounded-xl gap-1 overflow-x-auto" style={{ background: "#F1F5F9" }}>
                  {[
                    { id: "autentikasi", label: "Log Autentikasi", color: "#2563EB" },
                    { id: "registrasi", label: "Log Registrasi", color: "#16A34A" },
                    { id: "sistem", label: "Log Sistem", color: "#7C3AED" },
                  ].map((t) => (
                    <button
                      key={t.id}
                      onClick={() => handleTabChange(t.id as TabType)}
                      className="flex-1 py-2 px-3 rounded-lg text-center transition-all shrink-0 cursor-pointer"
                      style={{
                        background: tab === t.id ? "#FFFFFF" : "transparent",
                        boxShadow: tab === t.id ? "0 1px 4px rgba(30,41,59,0.1)" : "none",
                        color: tab === t.id ? t.color : "#94A3B8",
                        fontFamily: MONO,
                        fontSize: "0.62rem",
                        fontWeight: tab === t.id ? 700 : 500,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Actions Bar (Refresh, Hapus/Hapus Terpilih, Download CSV) */}
              <div className="px-5 py-2.5 flex items-center justify-between" style={{ borderBottom: "1px solid #EEF2F7" }}>
                <div className="flex items-center gap-2">
                  <button
                    onClick={loadLogsFromSQLite}
                    disabled={isLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-slate-700 hover:bg-slate-50 active:scale-95 text-[0.62rem] font-semibold cursor-pointer shadow-xs"
                    style={{ background: "#FFFFFF", borderColor: "#CBD5E1", fontFamily: MONO }}
                    title="Muat Ulang data dari SQLite"
                  >
                    <RefreshCw size={12} className={isLoading ? "animate-spin text-blue-600" : "text-slate-500"} />
                    <span>Refresh</span>
                  </button>

                  <button
                    onClick={handleDeleteLogs}
                    disabled={currentLogs.length === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border active:scale-95 text-[0.62rem] font-bold cursor-pointer transition-all shadow-xs"
                    style={{
                      background: isSomeSelected ? "#DC2626" : "#FEF2F2",
                      borderColor: isSomeSelected ? "#B91C1C" : "#FECACA",
                      color: isSomeSelected ? "#FFFFFF" : "#DC2626",
                      fontFamily: MONO,
                      opacity: currentLogs.length === 0 ? 0.5 : 1,
                      cursor: currentLogs.length === 0 ? "not-allowed" : "pointer",
                    }}
                    title={isSomeSelected ? `Hapus ${selectedIds.length} data terpilih` : "Hapus seluruh log di tab ini"}
                  >
                    <Trash2 size={12} />
                    <span>{isSomeSelected ? `Hapus (${selectedIds.length})` : "Hapus Semua"}</span>
                  </button>

                  {isSomeSelected && (
                    <button
                      onClick={() => setSelectedIds([])}
                      className="text-[0.58rem] font-semibold text-slate-500 hover:text-slate-700 underline cursor-pointer ml-1"
                      style={{ fontFamily: MONO }}
                    >
                      Batal Pilih
                    </button>
                  )}
                </div>

                <button
                  onClick={downloadCSV}
                  disabled={currentLogs.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all active:scale-95 cursor-pointer shadow-xs"
                  style={{
                    background: "#F8FAFC",
                    border: "1px solid #CBD5E1",
                    opacity: currentLogs.length === 0 ? 0.5 : 1,
                    cursor: currentLogs.length === 0 ? "not-allowed" : "pointer",
                  }}
                >
                  <Download size={12} style={{ color: "#475569" }} />
                  <span style={{ color: "#475569", fontFamily: MONO, fontSize: "0.62rem", fontWeight: 700 }}>
                    {isSomeSelected ? `Unduh Terpilih (${selectedIds.length})` : "Unduh CSV"}
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
                          <th className="px-3 py-2.5 w-8">
                            <input
                              type="checkbox"
                              checked={isAllSelected}
                              onChange={toggleSelectAll}
                              className="rounded cursor-pointer accent-blue-600 w-3.5 h-3.5"
                              title={isAllSelected ? "Batal pilih semua" : "Pilih semua"}
                            />
                          </th>
                          {["No", "Waktu", "User ID", "Skor", "Status", "Aksi"].map((h) => (
                            <th key={h} className="px-3 py-2.5" style={{ color: "#94A3B8", fontSize: "0.58rem", fontWeight: 600, textTransform: "uppercase" }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {authLogs.map((r, i) => {
                          const isChecked = selectedIds.includes(r.id);
                          return (
                            <tr
                              key={r.id || i}
                              className={`transition-colors ${isChecked ? "bg-blue-50/60" : "hover:bg-slate-50"}`}
                              style={{ borderBottom: "1px solid #F8FAFC" }}
                            >
                              <td className="px-3 py-2.5 w-8">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleSelect(r.id)}
                                  className="rounded cursor-pointer accent-blue-600 w-3.5 h-3.5"
                                />
                              </td>
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
                                {r.score}%
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
                              <td className="px-3 py-2.5">
                                <button
                                  onClick={() => openDetail(r, "autentikasi")}
                                  className="px-2.5 py-1 rounded-lg flex items-center gap-1 text-[0.58rem] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-all active:scale-95 cursor-pointer"
                                >
                                  <Eye size={11} />
                                  <span>Detail</span>
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                        {authLogs.length === 0 && (
                          <tr>
                            <td colSpan={7} className="px-4 py-8 text-center" style={{ color: "#94A3B8", fontSize: "0.65rem" }}>
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
                          <th className="px-3 py-2.5 w-8">
                            <input
                              type="checkbox"
                              checked={isAllSelected}
                              onChange={toggleSelectAll}
                              className="rounded cursor-pointer accent-blue-600 w-3.5 h-3.5"
                              title={isAllSelected ? "Batal pilih semua" : "Pilih semua"}
                            />
                          </th>
                          {["No", "Waktu", "Slot User", "Langkah", "Status", "Aksi"].map((h) => (
                            <th key={h} className="px-3 py-2.5" style={{ color: "#94A3B8", fontSize: "0.58rem", fontWeight: 600, textTransform: "uppercase" }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {regLogs.map((r, i) => {
                          const isChecked = selectedIds.includes(r.id);
                          return (
                            <tr
                              key={r.id || i}
                              className={`transition-colors ${isChecked ? "bg-blue-50/60" : "hover:bg-slate-50"}`}
                              style={{ borderBottom: "1px solid #F8FAFC" }}
                            >
                              <td className="px-3 py-2.5 w-8">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleSelect(r.id)}
                                  className="rounded cursor-pointer accent-blue-600 w-3.5 h-3.5"
                                />
                              </td>
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
                              <td className="px-3 py-2.5">
                                <button
                                  onClick={() => openDetail(r, "registrasi")}
                                  className="px-2.5 py-1 rounded-lg flex items-center gap-1 text-[0.58rem] font-bold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-all active:scale-95 cursor-pointer"
                                >
                                  <Eye size={11} />
                                  <span>Detail</span>
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                        {regLogs.length === 0 && (
                          <tr>
                            <td colSpan={7} className="px-4 py-8 text-center" style={{ color: "#94A3B8", fontSize: "0.65rem" }}>
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
                          <th className="px-3 py-2.5 w-8">
                            <input
                              type="checkbox"
                              checked={isAllSelected}
                              onChange={toggleSelectAll}
                              className="rounded cursor-pointer accent-blue-600 w-3.5 h-3.5"
                              title={isAllSelected ? "Batal pilih semua" : "Pilih semua"}
                            />
                          </th>
                          {["No", "Waktu", "Status", "Pesan"].map((h) => (
                            <th key={h} className="px-4 py-2.5" style={{ color: "#94A3B8", fontSize: "0.58rem", fontWeight: 600, textTransform: "uppercase" }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {systemLogs.map((r, i) => {
                          const isChecked = selectedIds.includes(r.id);
                          return (
                            <tr
                              key={r.id || i}
                              className={`transition-colors ${isChecked ? "bg-blue-50/60" : "hover:bg-slate-50"}`}
                              style={{ borderBottom: "1px solid #F8FAFC" }}
                            >
                              <td className="px-3 py-2.5 w-8">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleSelect(r.id)}
                                  className="rounded cursor-pointer accent-blue-600 w-3.5 h-3.5"
                                />
                              </td>
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
                                    background: (r.status === "Success" || r.status === "Info") ? "#F0FDF4" : "#FEF2F2",
                                    color: (r.status === "Success" || r.status === "Info") ? "#16A34A" : "#DC2626",
                                    border: `1px solid ${(r.status === "Success" || r.status === "Info") ? "#BBF7D0" : "#FECACA"}`,
                                  }}
                                >
                                  {r.status}
                                </span>
                              </td>
                              <td className="px-4 py-2.5" style={{ color: "#1E293B", fontSize: "0.62rem" }}>
                                {r.message}
                              </td>
                            </tr>
                          );
                        })}
                        {systemLogs.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-4 py-8 text-center" style={{ color: "#94A3B8", fontSize: "0.65rem" }}>
                              Belum ada riwayat sistem di database SQLite.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </AnimatePresence>
              </div>

              {/* Bottom safe area */}
              <div className="h-5 shrink-0" />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Modal Detail Rincian Sesi */}
      <LogDetailModal
        open={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        record={selectedRecord}
        type={selectedType}
      />
    </>
  );
}
