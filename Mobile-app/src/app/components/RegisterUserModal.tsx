import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, User, AlertCircle, ArrowRight, RefreshCw, HardDrive } from "lucide-react";
import { databaseService, UserProfile, RegLogRecord } from "../services/databaseService";
import { useBLE } from "../context/BLEContext";

interface RegisterUserModalProps {
  open: boolean;
  onClose: () => void;
  onStart: (slot: number, name: string) => void;
}

const MONO = "JetBrains Mono, monospace";
const SANS = "Inter, sans-serif";

export function RegisterUserModal({ open, onClose, onStart }: RegisterUserModalProps) {
  const { connectionState, syncFlashUsers, flashSyncVersion, addLog } = useBLE();
  const [selectedSlot, setSelectedSlot] = useState<number>(0);
  const [userName, setUserName] = useState<string>("");
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [regLogs, setRegLogs] = useState<RegLogRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isSyncingFlash, setIsSyncingFlash] = useState<boolean>(false);

  // Helper untuk mengekstrak status dan nama pada slot tertentu dari profil aktif dan log
  const getSlotInfo = useCallback((slotIdx: number) => {
    const prof = profiles.find((p) => p.slot === slotIdx);
    const matchingLog = regLogs.find((r) => r.slotUser.includes(`Slot ${slotIdx + 1}`));
    const isFilled = Boolean(prof || matchingLog);
    const name = prof?.name || (matchingLog?.slotUser.match(/\((.*?)\)/)?.[1] ?? "");
    return { isFilled, name, profile: prof, log: matchingLog };
  }, [profiles, regLogs]);

  // Muat data profil yang tersimpan di SQLite & Log Registrasi
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [userProfiles, logs] = await Promise.all([
        databaseService.getUserProfiles(),
        databaseService.getRegLogs(50),
      ]);
      setProfiles(userProfiles);
      setRegLogs(logs);

      // Auto-sinkronisasi mandiri: jika ada log registrasi tapi belum ada di user_profiles, simpan otomatis
      for (let i = 0; i < 4; i++) {
        const matchingLog = logs.find((r) => r.slotUser.includes(`Slot ${i + 1}`));
        const existingProf = userProfiles.find((p) => p.slot === i);
        if (matchingLog && !existingProf) {
          const extractedName = matchingLog.slotUser.match(/\((.*?)\)/)?.[1] || `User_${i + 1}`;
          await databaseService.saveUserProfile(i, extractedName);
        }
      }

      // Hitung slot terisi
      const occupiedSlots = new Set<number>();
      for (let i = 0; i < 4; i++) {
        const prof = userProfiles.find((p) => p.slot === i);
        const matchingLog = logs.find((r) => r.slotUser.includes(`Slot ${i + 1}`));
        if (prof || matchingLog) {
          occupiedSlots.add(i);
        }
      }

      // Pilih slot kosong pertama secara cerdas atau pertahankan slot jika valid
      setSelectedSlot((prev) => {
        let nextSlot = prev;
        if (occupiedSlots.has(prev)) {
          let emptyFound = -1;
          for (let i = 0; i < 4; i++) {
            if (!occupiedSlots.has(i)) {
              emptyFound = i;
              break;
            }
          }
          nextSlot = emptyFound !== -1 ? emptyFound : prev;
        }

        const prof = userProfiles.find((p) => p.slot === nextSlot);
        const matchingLog = logs.find((r) => r.slotUser.includes(`Slot ${nextSlot + 1}`));
        const curName = prof?.name || (matchingLog?.slotUser.match(/\((.*?)\)/)?.[1] ?? "");
        setUserName(curName);

        return nextSlot;
      });
    } catch (err) {
      console.error("Gagal memuat profil pengguna:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Sinkronisasi data saat modal terbuka atau saat flashSyncVersion berubah
  useEffect(() => {
    if (open) {
      loadData();
    }
  }, [open, flashSyncVersion, loadData]);

  // Tombol Refresh / Sync Flash RP2040
  const handleRefresh = async () => {
    setLoading(true);
    try {
      if (connectionState === "connected") {
        setIsSyncingFlash(true);
        await syncFlashUsers();
        // Beri jeda agar transmisi BLE FLASH_SLOT dan SQLite selesai sinkronisasi
        setTimeout(async () => {
          await loadData();
          setIsSyncingFlash(false);
          setLoading(false);
        }, 800);
      } else {
        addLog({
          type: "system",
          status: "Info",
          message: "Smart Key offline. Memuat data profil dari database SQLite lokal.",
        });
        await loadData();
        setLoading(false);
      }
    } catch (err) {
      console.error("Gagal sinkron:", err);
      setIsSyncingFlash(false);
      setLoading(false);
    }
  };

  // Saat ganti slot terpilih, sesuaikan nilai default nama
  const handleSelectSlot = (slot: number) => {
    setSelectedSlot(slot);
    const info = getSlotInfo(slot);
    setUserName(info.isFilled ? info.name : "");
  };

  const currentSlotInfo = getSlotInfo(selectedSlot);
  const isOccupied = currentSlotInfo.isFilled;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalName = userName.trim() || `User_${selectedSlot + 1}`;
    onStart(selectedSlot, finalName);
  };

  if (!open) return null;

  return (
    <AnimatePresence>
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
          className="relative w-full max-w-md rounded-2xl overflow-hidden shadow-2xl flex flex-col z-10"
          style={{ background: "#FFFFFF", border: "1px solid #E2E8F0" }}
          initial={{ scale: 0.94, opacity: 0, y: 16 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.94, opacity: 0, y: 16 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
        >
          {/* Header */}
          <div className="px-5 py-4 flex items-center justify-between border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center text-blue-600 bg-blue-50 border border-blue-200">
                <User size={16} />
              </div>
              <div>
                <h3 style={{ color: "#0F172A", fontFamily: SANS, fontWeight: 700, fontSize: "0.92rem" }}>
                  Pendaftaran Pengguna Baru
                </h3>
                <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.62rem" }}>
                  Kapasitas 4 Slot Pemilik Smart Key
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleRefresh}
                disabled={loading || isSyncingFlash}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-slate-700 hover:bg-white active:scale-95 text-[0.62rem] font-semibold cursor-pointer shadow-xs transition-all disabled:opacity-50"
                style={{ background: "#FFFFFF", borderColor: "#CBD5E1", fontFamily: MONO }}
                title={connectionState === "connected" ? "Sinkronkan dengan Flash RP2040 & Database" : "Muat Ulang data dari SQLite"}
              >
                <RefreshCw size={11} className={(loading || isSyncingFlash) ? "animate-spin text-blue-600" : "text-slate-500"} />
                <span>{isSyncingFlash ? "Sync..." : "Sync Flash"}</span>
              </button>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all cursor-pointer"
                title="Tutup"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Form Content */}
          <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-3.5">
            {/* Status Memori Flash Hardware */}
            <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 border border-slate-200">
              <div className="flex items-center gap-2">
                <HardDrive size={13} className="text-blue-600 shrink-0" />
                <span style={{ fontFamily: MONO, fontSize: "0.62rem", color: "#475569" }}>
                  Memori Flash RP2040:
                </span>
              </div>
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

            {/* Pemilihan 4 Slot */}
            <div>
              <label style={{ color: "#334155", fontFamily: SANS, fontSize: "0.75rem", fontWeight: 600 }}>
                Pilih Slot Pengguna (1 - 4)
              </label>
              <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.6rem", marginTop: 2 }}>
                Pilih slot kosong atau pilih slot lama untuk menimpa:
              </p>

              {/* Grid 4 Slot */}
              <div className="grid grid-cols-2 gap-2 mt-2">
                {[0, 1, 2, 3].map((slotIdx) => {
                  const { isFilled, name } = getSlotInfo(slotIdx);
                  const isSelected = selectedSlot === slotIdx;

                  return (
                    <button
                      key={slotIdx}
                      type="button"
                      onClick={() => handleSelectSlot(slotIdx)}
                      className="p-3 rounded-xl text-left border transition-all cursor-pointer flex flex-col justify-between"
                      style={{
                        background: isSelected ? "#EFF6FF" : isFilled ? "#FFFFFF" : "#F8FAFC",
                        borderColor: isSelected ? "#2563EB" : isFilled ? "#86EFAC" : "#E2E8F0",
                        boxShadow: isSelected
                          ? "0 0 0 1.5px #2563EB"
                          : isFilled
                          ? "0 1px 4px rgba(34,197,94,0.08)"
                          : "none",
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          style={{
                            fontFamily: MONO,
                            fontWeight: 700,
                            fontSize: "0.72rem",
                            color: isSelected ? "#1D4ED8" : "#334155",
                          }}
                        >
                          SLOT 0{slotIdx + 1}
                        </span>
                        {isFilled ? (
                          <span
                            className="px-1.5 py-0.5 rounded text-[0.52rem] font-bold"
                            style={{
                              background: "#DCFCE7",
                              color: "#15803D",
                              border: "1px solid #BBF7D0",
                              fontFamily: MONO,
                            }}
                          >
                            Terisi
                          </span>
                        ) : (
                          <span
                            className="px-1.5 py-0.5 rounded text-[0.52rem] font-bold"
                            style={{
                              background: "#F1F5F9",
                              color: "#64748B",
                              border: "1px solid #E2E8F0",
                              fontFamily: MONO,
                            }}
                          >
                            Kosong
                          </span>
                        )}
                      </div>
                      <p
                        className="mt-1.5 truncate"
                        style={{
                          fontFamily: SANS,
                          fontSize: "0.7rem",
                          fontWeight: isFilled ? 700 : 400,
                          color: isFilled ? "#0F172A" : "#94A3B8",
                        }}
                      >
                        {isFilled ? name : "Belum terdaftar"}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Input Nama User */}
            <div>
              <label htmlFor="regUserName" style={{ color: "#334155", fontFamily: SANS, fontSize: "0.75rem", fontWeight: 600 }}>
                Nama Pengguna (Maksimal 15 Karakter)
              </label>
              <input
                id="regUserName"
                type="text"
                maxLength={15}
                required
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder={`Contoh: User_${selectedSlot + 1}`}
                className="mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                style={{ fontFamily: SANS }}
                autoFocus
              />
            </div>

            {/* Alert jika menimpa slot terisi */}
            {isOccupied && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2.5">
                <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                <p style={{ color: "#92400E", fontFamily: SANS, fontSize: "0.68rem", lineHeight: 1.35 }}>
                  <strong>Perhatian:</strong> Slot {selectedSlot + 1} saat ini milik <strong>{currentSlotInfo.name || `User ${selectedSlot + 1}`}</strong>. Melanjutkan perekaman akan menimpa model biometrik lama di Flash memori RP2040.
                </p>
              </div>
            )}

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-xs hover:bg-slate-50 transition-all cursor-pointer"
                style={{ fontFamily: MONO }}
              >
                BATAL
              </button>
              <button
                type="submit"
                disabled={!userName.trim()}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-white font-bold text-xs shadow-sm transition-all active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: "linear-gradient(135deg,#2563EB,#1D4ED8)",
                  fontFamily: MONO,
                }}
              >
                <span>MULAI PEREKAMAN</span>
                <ArrowRight size={13} />
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
