import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Download, Trash2, RefreshCw, Eye, HardDrive, ShieldCheck, Pencil } from "lucide-react";
import {
  databaseService,
  AuthLogRecord,
  RegLogRecord,
  SystemLogRecord,
  UserProfile,
} from "../services/databaseService";
import { LogDetailModal } from "./LogDetailModal";
import { ExportService } from "../services/exportService";
import { useBLE } from "../context/BLEContext";

type TabType = "autentikasi" | "registrasi" | "sistem";

const MONO = "JetBrains Mono, monospace";
const SANS = "Inter, sans-serif";

interface LogSheetProps {
  open: boolean;
  onClose: () => void;
}

function renderTimestamp(ts: string) {
  if (!ts) return <span className="text-[0.62rem] text-slate-400 font-mono">—</span>;
  const parts = ts.trim().split(/[,\s]+/);
  if (parts.length >= 2) {
    const datePart = parts[0];
    const timePart = parts.slice(1).join(" ");
    return (
      <div className="flex flex-col leading-[1.25] text-left">
        <span className="text-[0.62rem] text-slate-700 font-semibold tracking-tight">{datePart}</span>
        <span className="text-[0.56rem] text-slate-400 font-mono">{timePart}</span>
      </div>
    );
  }
  return <span className="text-[0.62rem] text-slate-600 font-mono">{ts}</span>;
}

export function LogSheet({ open, onClose }: LogSheetProps) {
  const {
    connectionState,
    sendCommand,
    addLog,
    syncFlashUsers,
    deleteFlashUser,
    formatFlashMemory,
    flashSyncVersion,
  } = useBLE();
  const [tab, setTab] = useState<TabType>("autentikasi");

  // State log dari SQLite
  const [authLogs, setAuthLogs] = useState<AuthLogRecord[]>([]);
  const [regLogs, setRegLogs] = useState<RegLogRecord[]>([]);
  const [systemLogs, setSystemLogs] = useState<SystemLogRecord[]>([]);
  const [userProfiles, setUserProfiles] = useState<UserProfile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncingFlash, setIsSyncingFlash] = useState(false);

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
        const [data, profiles] = await Promise.all([
          databaseService.getRegLogs(),
          databaseService.getUserProfiles(),
        ]);
        setRegLogs(data);
        setUserProfiles(profiles);
      } else if (tab === "sistem") {
        const data = await databaseService.getSystemLogs();
        setSystemLogs(data);
      }
      setSelectedIds([]);
    } catch (err) {
      console.error("Gagal membaca log dari SQLite:", err);
    } finally {
      setTimeout(() => setIsLoading(false), 250);
    }
  }, [tab]);

  // Muat data saat sheet terbuka, ganti tab, atau terjadi pembaruan flash hardware
  useEffect(() => {
    if (open) {
      loadLogsFromSQLite().then(() => {
        setIsSyncingFlash(false);
        setIsLoading(false);
      });
    }
  }, [open, tab, flashSyncVersion, loadLogsFromSQLite]);

  // Tombol Refresh / Sync Flash: Sinkronisasi data slot dengan Flash RP2040 (hanya aktif di tab registrasi saat BLE terhubung)
  const handleRefresh = async () => {
    if (tab !== "registrasi" || connectionState !== "connected" || isLoading || isSyncingFlash) return;
    setIsLoading(true);
    setIsSyncingFlash(true);
    try {
      await syncFlashUsers();
      // Jeda agar BLE dan SQLite selesai sinkronisasi jika event FLASH_SYNC_DONE tertunda
      setTimeout(async () => {
        await loadLogsFromSQLite();
        setIsSyncingFlash(false);
        setIsLoading(false);
      }, 800);
    } catch (err) {
      console.error("Gagal sinkronisasi flash:", err);
      setIsSyncingFlash(false);
      setIsLoading(false);
    }
  };

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

  // Ganti / Rename User ID untuk riwayat log autentikasi
  const handleRenameAuthLog = async (rec: AuthLogRecord) => {
    const currentName = rec.userId || "Unknown / Rejected";
    const newName = window.prompt(
      `Ganti label / User ID sesi ini:\n(Waktu: ${rec.timestamp}, Skor: ${rec.score || "—"})\n\nContoh: "jalan biasa", "jalan agak cepat", "tangan ngayun", "saku jaket"`,
      currentName
    );
    if (!newName || !newName.trim() || newName.trim() === currentName) return;

    const trimmed = newName.trim();
    try {
      await databaseService.updateAuthLogUserId(rec.id, trimmed);
      setAuthLogs((prev) =>
        prev.map((a) => (a.id === rec.id ? { ...a, userId: trimmed } : a))
      );
      addLog({
        type: "system",
        status: "Info",
        message: `Label User ID autentikasi diubah menjadi "${trimmed}".`,
      });
    } catch (err) {
      console.error("Gagal update user id log:", err);
      alert(`Gagal mengubah nama User ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Hapus single row slot registrasi
  const handleDeleteSingleSlot = async (rec: RegLogRecord) => {
    if (connectionState !== "connected") {
      alert(
        "Perhatian: Perangkat Smart Key belum terhubung via Bluetooth!\n\nUntuk menghapus profil registrasi, sambungkan Bluetooth terlebih dahulu agar data model biometrik di Flash memori RP2040 ikut terhapus secara sinkron."
      );
      return;
    }

    const match = rec.slotUser.match(/Slot\s+(\d+)/i);
    const slotIdx = match ? parseInt(match[1], 10) - 1 : -1;

    if (
      confirm(
        `Apakah Anda yakin ingin menghapus "${rec.slotUser}"?\n\nProfil ini akan dihapus dari memori Flash RP2040 dan database aplikasi secara permanen.`
      )
    ) {
      if (slotIdx >= 0 && slotIdx < 4) {
        await deleteFlashUser(slotIdx);
      }
      await databaseService.deleteLogsByIds("registrasi", [rec.id]);
      await loadLogsFromSQLite();
    }
  };

  // Hapus langsung dari badge slot Flash
  const handleDeleteSlotDirect = async (slotIdx: number, userName: string) => {
    if (connectionState !== "connected") {
      alert(
        "Perhatian: Perangkat Smart Key belum terhubung via Bluetooth!\n\nSambungkan Bluetooth terlebih dahulu agar slot di Flash memori RP2040 dapat dihapus."
      );
      return;
    }

    if (
      confirm(
        `Hapus Slot ${slotIdx + 1} (${userName}) dari Flash memori RP2040 dan database?`
      )
    ) {
      await deleteFlashUser(slotIdx);
      await loadLogsFromSQLite();
    }
  };

  // Hapus log dari SQLite (Bisa batch terpilih atau hapus semua)
  const handleDeleteLogs = async () => {
    const tabName = tab === "autentikasi" ? "Log Autentikasi" : tab === "registrasi" ? "Log Registrasi" : "Log Sistem";

    // Proteksi khusus tab Registrasi: Wajib terkoneksi BLE agar Flash memory RP2040 ikut terhapus
    if (tab === "registrasi") {
      if (connectionState !== "connected") {
        alert(
          "Perhatian: Perangkat Smart Key belum terhubung via Bluetooth!\n\nUntuk menghapus profil registrasi, sambungkan Bluetooth terlebih dahulu agar data model biometrik di Flash memori perangkat ikut terhapus secara sinkron."
        );
        return;
      }
    }

    if (isSomeSelected) {
      if (confirm(`Apakah Anda yakin ingin menghapus ${selectedIds.length} data terpilih dari ${tabName}?`)) {
        if (tab === "registrasi") {
          // Sinkronkan penghapusan slot ke Flash RP2040
          const logsToDelete = regLogs.filter((r) => selectedIds.includes(r.id));
          for (const r of logsToDelete) {
            const match = r.slotUser.match(/Slot\s+(\d+)/i);
            if (match) {
              const slotIdx = parseInt(match[1], 10) - 1; // 1-indexed ke 0-indexed
              if (slotIdx >= 0 && slotIdx < 4) {
                await deleteFlashUser(slotIdx);
              }
            }
          }
        }

        await databaseService.deleteLogsByIds(tab, selectedIds);
        setSelectedIds([]);
        await loadLogsFromSQLite();
      }
    } else {
      if (
        confirm(
          `Apakah Anda yakin ingin menghapus SELURUH ${tabName} dari database?${
            tab === "registrasi" ? "\n\nPerhatian: Seluruh model biometrik di Flash memori RP2040 juga akan diformat bersih!" : ""
          }`
        )
      ) {
        if (tab === "registrasi") {
          await formatFlashMemory();
        }

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
        csv += `${i + 1},"${r.timestamp}","${r.slotUser}","${Math.min(r.totalJendela, 5)}/5","${r.statusAkhir}","${r.message || ''}"\r\n`;
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
                  {tab === "registrasi" && (
                    <button
                      onClick={handleRefresh}
                      disabled={connectionState !== "connected" || isLoading || isSyncingFlash}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-slate-700 hover:bg-slate-50 active:scale-95 text-[0.62rem] font-semibold shadow-xs transition-all"
                      style={{
                        background: connectionState !== "connected" ? "#F8FAFC" : "#FFFFFF",
                        borderColor: connectionState !== "connected" ? "#E2E8F0" : "#CBD5E1",
                        color: connectionState !== "connected" ? "#94A3B8" : "#334155",
                        opacity: connectionState !== "connected" ? 0.55 : 1,
                        cursor: connectionState !== "connected" ? "not-allowed" : "pointer",
                        fontFamily: MONO,
                      }}
                      title={connectionState !== "connected" ? "Smart Key offline (Hubungkan BLE untuk sinkronisasi Flash RP2040)" : "Sinkronkan slot profil pengguna dengan Flash RP2040"}
                    >
                      <RefreshCw
                        size={12}
                        className={
                          isLoading || isSyncingFlash
                            ? "animate-spin text-emerald-600"
                            : connectionState === "connected"
                            ? "text-slate-500"
                            : "text-slate-400"
                        }
                      />
                      <span>{isSyncingFlash ? "Sync Flash..." : "Sync Flash"}</span>
                    </button>
                  )}

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

                {tab !== "sistem" && (
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
                )}
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
                          const isBypass = (r.userId && (r.userId.toLowerCase().includes("bypass") || r.userId === "PIN_BYPASS")) || r.status === "BYPASS";
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
                              <td className="px-3 py-2.5">
                                {renderTimestamp(r.timestamp)}
                              </td>
                              <td className="px-3 py-2.5" style={{ color: "#1E293B", fontSize: "0.62rem", fontWeight: 600 }}>
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate max-w-[130px]">{r.userId}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleRenameAuthLog(r)}
                                    className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 active:scale-95 transition-all cursor-pointer"
                                    title="Ganti nama/label User ID sesi ini"
                                  >
                                    <Pencil size={11} />
                                  </button>
                                </div>
                              </td>
                              <td className="px-3 py-2.5" style={{ color: "#2563EB", fontSize: "0.62rem", fontWeight: 700 }}>
                                {r.score !== undefined && r.score !== null ? (String(r.score).endsWith("%") ? r.score : `${r.score}%`) : "—"}
                              </td>
                              <td className="px-3 py-2.5">
                                <span
                                  className="px-2 py-0.5 rounded-md text-[0.58rem] font-bold inline-block"
                                  style={{
                                    background: r.status === "SUCCESS" ? "#F0FDF4" : r.status === "BYPASS" ? "#EFF6FF" : "#FEF2F2",
                                    color: r.status === "SUCCESS" ? "#16A34A" : r.status === "BYPASS" ? "#2563EB" : "#DC2626",
                                    border: `1px solid ${r.status === "SUCCESS" ? "#BBF7D0" : r.status === "BYPASS" ? "#BFDBFE" : "#FECACA"}`,
                                  }}
                                >
                                  {r.status}
                                </span>
                              </td>
                              <td className="px-3 py-2.5">
                                {isBypass ? (
                                  <span className="text-[0.62rem] text-slate-400 font-mono italic px-2">
                                    —
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => openDetail(r, "autentikasi")}
                                    className="px-2.5 py-1 rounded-lg flex items-center gap-1 text-[0.58rem] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-all active:scale-95 cursor-pointer"
                                  >
                                    <Eye size={11} />
                                    <span>Detail</span>
                                  </button>
                                )}
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

                  {/* 2. TAB REGISTRASI (Satu Tampilan Tunggal Terpadu dengan Flash Hardware) */}
                  {tab === "registrasi" && (
                    <div className="flex flex-col p-4 gap-3">
                      {/* Header Status Memori Flash Hardware RP2040 */}
                      <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-100 text-blue-700 border border-blue-200">
                            <HardDrive size={16} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p style={{ color: "#1E293B", fontFamily: SANS, fontWeight: 700, fontSize: "0.82rem" }}>
                                Status Memori Flash RP2040 (Non-Volatile)
                              </p>
                              <span
                                className="px-2 py-0.5 rounded-full text-[0.55rem] font-bold"
                                style={{
                                  background: connectionState === "connected" ? "#F0FDF4" : "#F1F5F9",
                                  color: connectionState === "connected" ? "#16A34A" : "#64748B",
                                  border: `1px solid ${connectionState === "connected" ? "#BBF7D0" : "#CBD5E1"}`,
                                  fontFamily: MONO,
                                }}
                              >
                                {connectionState === "connected"
                                  ? isSyncingFlash
                                    ? "● Membaca Flash..."
                                    : "● Terhubung & Sinkron"
                                  : "○ Offline (Data Lokal)"}
                              </span>
                            </div>
                            <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.6rem" }}>
                              Kapasitas 4 Slot Pengguna · Tersimpan permanen di chip flash internal
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* 4 Slot Pengguna Terpadu */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {[0, 1, 2, 3].map((slotIdx) => {
                          const profile = userProfiles.find((p) => p.slot === slotIdx);
                          const matchingLog = regLogs.find((r) => r.slotUser.includes(`Slot ${slotIdx + 1}`));
                          const isFilled = Boolean(profile || matchingLog);
                          const userName = profile?.name || (matchingLog?.slotUser.match(/\((.*?)\)/)?.[1] ?? `User ${slotIdx + 1}`);
                          const regTime = matchingLog?.timestamp || profile?.registeredAt || "-";
                          const totalJendela = matchingLog?.totalJendela ?? 5;
                          const statusAkhir = matchingLog?.statusAkhir ?? "SUCCESS";

                          const logToView: RegLogRecord = matchingLog || {
                            id: `flash_slot_${slotIdx}`,
                            timestamp: regTime,
                            slotUser: `Slot ${slotIdx + 1} (${userName})`,
                            totalJendela: 5,
                            statusAkhir: "SUCCESS",
                            message: `Profil Flash Hardware Aktif (${userName})`,
                            details: "",
                          };

                          return (
                            <div
                              key={slotIdx}
                              className="rounded-2xl border p-4 flex flex-col justify-between transition-all"
                              style={{
                                background: isFilled ? "#FFFFFF" : "#F8FAFC",
                                borderColor: isFilled ? "#86EFAC" : "#E2E8F0",
                                boxShadow: isFilled ? "0 2px 8px rgba(34,197,94,0.06)" : "none",
                              }}
                            >
                              <div>
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-1.5">
                                    <span
                                      className="px-2 py-0.5 rounded text-[0.6rem] font-bold"
                                      style={{
                                        background: isFilled ? "#EFF6FF" : "#F1F5F9",
                                        color: isFilled ? "#2563EB" : "#64748B",
                                        fontFamily: MONO,
                                      }}
                                    >
                                      SLOT 0{slotIdx + 1}
                                    </span>
                                  </div>
                                  <span
                                    className="px-2 py-0.5 rounded-full text-[0.55rem] font-bold"
                                    style={{
                                      background: isFilled ? "#DCFCE7" : "#F1F5F9",
                                      color: isFilled ? "#15803D" : "#64748B",
                                      border: `1px solid ${isFilled ? "#BBF7D0" : "#E2E8F0"}`,
                                      fontFamily: MONO,
                                    }}
                                  >
                                    {isFilled ? "TERDAFTAR (FLASH KVSTORE)" : "KOSONG / TERSEDIA"}
                                  </span>
                                </div>

                                <div className="my-1.5">
                                  <p
                                    className="truncate"
                                    style={{
                                      color: isFilled ? "#0F172A" : "#94A3B8",
                                      fontFamily: SANS,
                                      fontWeight: 700,
                                      fontSize: "0.95rem",
                                    }}
                                  >
                                    {isFilled ? userName : "— Slot Belum Terisi —"}
                                  </p>
                                  <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.6rem", marginTop: 2 }}>
                                    {isFilled
                                      ? `Model GHMM Biometrik Aktif di Chip RP2040`
                                      : "Siap digunakan untuk pendaftaran pengguna baru"}
                                  </p>
                                </div>

                                {isFilled ? (
                                  <div className="grid grid-cols-3 gap-2 mt-3 pt-2.5 border-t border-slate-100 text-center">
                                    <div className="p-1.5 rounded-lg bg-slate-50 border border-slate-100">
                                      <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.52rem", textTransform: "uppercase" }}>Waktu</p>
                                      <div className="mt-0.5 flex justify-center">{renderTimestamp(regTime)}</div>
                                    </div>
                                    <div className="p-1.5 rounded-lg bg-slate-50 border border-slate-100">
                                      <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.52rem", textTransform: "uppercase" }}>Langkah</p>
                                      <p style={{ color: "#16A34A", fontFamily: MONO, fontSize: "0.65rem", fontWeight: 700, marginTop: 1 }}>{Math.min(totalJendela, 5)}/5</p>
                                    </div>
                                    <div className="p-1.5 rounded-lg bg-slate-50 border border-slate-100">
                                      <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.52rem", textTransform: "uppercase" }}>Status</p>
                                      <p style={{ color: "#16A34A", fontFamily: MONO, fontSize: "0.65rem", fontWeight: 700, marginTop: 1 }}>{statusAkhir}</p>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="p-3 mt-3 rounded-lg bg-slate-50/70 border border-dashed border-slate-200 text-center">
                                    <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.62rem" }}>
                                      Slot ini kosong · Gunakan tombol "Mulai Registrasi" untuk merekam ke slot ini
                                    </p>
                                  </div>
                                )}
                              </div>

                              {/* Aksi Bar: Detail & Hapus */}
                              {isFilled && (
                                <div className="mt-3.5 pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2">
                                  <button
                                    onClick={() => openDetail(logToView, "registrasi")}
                                    className="flex-1 py-1.5 px-3 rounded-xl flex items-center justify-center gap-1.5 text-[0.62rem] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-all active:scale-95 cursor-pointer shadow-2xs"
                                    style={{ fontFamily: MONO }}
                                  >
                                    <Eye size={12} />
                                    <span>Lihat Rincian 5 Jendela</span>
                                  </button>

                                  <button
                                    onClick={() => handleDeleteSlotDirect(slotIdx, userName)}
                                    className="py-1.5 px-3 rounded-xl flex items-center justify-center gap-1.5 text-[0.62rem] font-bold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 transition-all active:scale-95 cursor-pointer shadow-2xs"
                                    style={{ fontFamily: MONO }}
                                    title={`Hapus Slot 0${slotIdx + 1} (${userName}) dari Flash RP2040`}
                                  >
                                    <Trash2 size={12} />
                                    <span>Hapus Slot</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
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
                              <td className="px-4 py-2.5">
                                {renderTimestamp(r.timestamp)}
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
