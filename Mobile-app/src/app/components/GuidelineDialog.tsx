import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Shield, Info, BookOpen } from "lucide-react";

interface GuidelineDialogProps {
  open: boolean;
  onClose: () => void;
  defaultTab?: "registration" | "authentication";
}

const CONTENT = {
  registration: {
    icon: Info,
    accent: "#2563EB",
    accentBg: "#EFF6FF",
    accentBorder: "#BFDBFE",
    title: "Panduan Sesi Registrasi",
    subtitle: "PENDAFTARAN AWAL PROFIL GAIT (TRAINING)",
    bullets: [
      {
        label: "Penempatan Sensor di Saku",
        text: "Letakkan unit Smart Key di dalam saku celana (depan atau belakang). Pastikan orientasi stabil dan tidak berputar bebas di dalam saku.",
      },
      {
        label: "Online Calibration (5 Detik Pertama)",
        text: "Saat registrasi dimulai, pengguna wajib berdiri diam selama 5 detik pertama agar sistem mengunci nilai offset bias kemiringan saku harian.",
      },
      {
        label: "Alas Kaki & Permukaan",
        text: "Gunakan alas kaki harian standar Anda (sepatu/sandal). Lakukan di permukaan datar tanpa sengaja mengubah kecepatan atau gaya berjalan.",
      },
      {
        label: "Karakteristik Langkah Nyata",
        text: "Berjalanlah secara santai dan konstan (1-2 langkah/detik). Sistem menggunakan ZUPT untuk memastikan data yang diproses adalah langkah kaki murni.",
      },
      {
        label: "Target 10 Jendela Valid",
        text: "Sistem mengumpulkan 10 jendela data valid (masing-masing 3 detik, 100 Hz). Selesaikan rangkaian jalan hingga progres mencapai 10/10.",
      },
      {
        label: "Penyimpanan Permanen",
        text: "Setelah 10 jendela terpenuhi, model GHMM awal (vektor rata-rata & kovariansi) akan disimpan otomatis ke memori flash internal perangkat.",
      },
    ],
  },
  authentication: {
    icon: Shield,
    accent: "#16A34A",
    accentBg: "#F0FDF4",
    accentBorder: "#BBF7D0",
    title: "Panduan Sesi Autentikasi",
    subtitle: "AKSES MASUK RUMAH OTOMATIS (INFERENSI)",
    bullets: [
      {
        label: "Pemrosesan Sambil Berjalan (On-the-Move)",
        text: "Pengguna cukup berjalan mendekati rumah. Sistem di saku celana menyaring sinyal via Filter Kalman dan mengumpulkan skor kecocokan GHMM.",
      },
      {
        label: "Ambang Batas Dinamis (Adaptive Threshold)",
        text: "Ambang batas toleransi disesuaikan otomatis mengikuti amplitudo langkah terakhir pengguna guna mengantisipasi kelelahan fisik harian.",
      },
      {
        label: "Asynchronous State-Caching",
        text: "Saat 10 jendela valid terkonfirmasi lolos, status 'Sah' diendapkan di memori internal Smart Key sambil pengguna terus melangkah menuju pintu.",
      },
      {
        label: "Eksekusi Solenoid Pintu Tanpa Kontak",
        text: "Begitu langkah kaki memasuki perimeter radius BLE pintu (ESP32), Smart Key mengirimkan perintah buka pintu dan relay solenoid aktif seketika.",
      },
      {
        label: "Personalisasi Inkremental (Self-Adaptive EMA)",
        text: "Setiap autentikasi berhasil akan memperbarui model biometrik secara halus via Exponential Moving Average agar terus adaptif terhadap variasi harian.",
      },
      {
        label: "Emergency Bypass (Cadangan Darurat)",
        text: "Jika pengguna cedera kaki berat atau sensor terkendala, buka tombol Bypass di aplikasi dan masukkan 6 digit PIN darurat (respons < 1 detik).",
      },
    ],
  },
};

const MONO = "JetBrains Mono, monospace";
const SANS = "Inter, sans-serif";

export function GuidelineDialog({ open, onClose, defaultTab = "registration" }: GuidelineDialogProps) {
  const [tab, setTab] = useState<"registration" | "authentication">(defaultTab);

  useEffect(() => {
    if (open) {
      setTab(defaultTab);
    }
  }, [open, defaultTab]);

  const data = CONTENT[tab];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 select-none"
          style={{ background: "rgba(30,41,59,0.5)", backdropFilter: "blur(4px)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-sm md:max-w-md rounded-2xl overflow-hidden flex flex-col"
            style={{
              background: "#FFFFFF",
              boxShadow: "0 20px 60px rgba(30,41,59,0.2), 0 4px 16px rgba(30,41,59,0.08)",
              border: "1px solid #E2E8F0",
              maxHeight: "88vh",
            }}
            initial={{ scale: 0.94, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.94, opacity: 0, y: 16 }}
            transition={{ type: "spring", damping: 26, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 pt-4 pb-3 border-b border-[#F1F5F9] shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-blue-50 border border-blue-200"
                  >
                    <BookOpen size={16} className="text-blue-600" />
                  </div>
                  <div>
                    <h2 style={{ color: "#1E293B", fontFamily: SANS, fontWeight: 700, fontSize: "0.88rem", lineHeight: 1.2 }}>
                      Panduan Sistem Smart Key
                    </h2>
                    <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.58rem", marginTop: 2, letterSpacing: "0.06em" }}>
                      KETENTUAN OPERASIONAL & ATURAN GAIT
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                  style={{ background: "#F1F5F9", color: "#64748B" }}
                >
                  <X size={13} />
                </button>
              </div>

              {/* Segmented Tab Controls (2 Tab) */}
              <div className="flex p-1 rounded-xl bg-slate-100 gap-1 mt-3">
                <button
                  type="button"
                  onClick={() => setTab("registration")}
                  className={`flex-1 py-2 px-2.5 rounded-lg text-center transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    tab === "registration"
                      ? "bg-white text-blue-600 shadow-xs font-bold"
                      : "text-slate-500 font-medium hover:text-slate-700"
                  }`}
                  style={{ fontFamily: MONO, fontSize: "0.65rem" }}
                >
                  <Info size={13} style={{ color: tab === "registration" ? "#2563EB" : "#64748B" }} />
                  <span>Panduan Registrasi</span>
                </button>

                <button
                  type="button"
                  onClick={() => setTab("authentication")}
                  className={`flex-1 py-2 px-2.5 rounded-lg text-center transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    tab === "authentication"
                      ? "bg-white text-emerald-600 shadow-xs font-bold"
                      : "text-slate-500 font-medium hover:text-slate-700"
                  }`}
                  style={{ fontFamily: MONO, fontSize: "0.65rem" }}
                >
                  <Shield size={13} style={{ color: tab === "authentication" ? "#16A34A" : "#64748B" }} />
                  <span>Panduan Autentikasi</span>
                </button>
              </div>
            </div>

            {/* Sub-header status bar per tab */}
            <div
              className="px-5 py-2 border-b flex items-center justify-between shrink-0"
              style={{
                background: data.accentBg,
                borderColor: data.accentBorder,
              }}
            >
              <p style={{ color: data.accent, fontFamily: MONO, fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.06em" }}>
                {data.title.toUpperCase()}
              </p>
              <span
                className="px-2 py-0.5 rounded text-[0.55rem] font-bold"
                style={{ background: "#FFFFFF", color: data.accent, border: `1px solid ${data.accentBorder}`, fontFamily: MONO }}
              >
                {tab === "registration" ? "MODE TRAINING" : "MODE REAL-TIME"}
              </span>
            </div>

            {/* Bullets List */}
            <div className="px-5 py-4 space-y-3.5 overflow-y-auto flex-1" style={{ maxHeight: "55vh" }}>
              {data.bullets.map((b, i) => (
                <div key={i} className="flex gap-3 items-start">
                  <div
                    className="mt-1 w-2 h-2 rounded-full shrink-0"
                    style={{ background: data.accent }}
                  />
                  <div className="flex-1">
                    <p style={{ color: data.accent, fontFamily: MONO, fontWeight: 700, fontSize: "0.68rem" }}>
                      {b.label}
                    </p>
                    <p style={{ color: "#475569", fontFamily: SANS, fontSize: "0.74rem", marginTop: 2, lineHeight: 1.45 }}>
                      {b.text}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="px-5 pb-4 pt-2 border-t border-[#F1F5F9] shrink-0">
              <button
                onClick={onClose}
                className="w-full py-2.5 rounded-xl transition-all active:scale-[0.98] cursor-pointer"
                style={{
                  background: data.accentBg,
                  border: `1px solid ${data.accentBorder}`,
                  color: data.accent,
                  fontFamily: MONO,
                  fontWeight: 700,
                  fontSize: "0.7rem",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                Saya Mengerti
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
