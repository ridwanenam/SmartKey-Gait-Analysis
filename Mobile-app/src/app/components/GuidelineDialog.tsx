import { motion, AnimatePresence } from "motion/react";
import { X, Shield, Info } from "lucide-react";

interface GuidelineDialogProps {
  open: boolean;
  type: "registration" | "authentication" | null;
  onClose: () => void;
}

const CONTENT = {
  registration: {
    icon: Info,
    accent: "#2563EB",
    accentBg: "#EFF6FF",
    accentBorder: "#BFDBFE",
    title: "Panduan Batasan Gaya Berjalan",
    subtitle: "PENEMPATAN SENSOR & ATURAN LATIHAN",
    bullets: [
      { label: "Penempatan Perangkat", text: "Pasang unit sensor di punggung bawah (vertebra L4–L5) menggunakan klip bawaan. Pastikan menempel rapat pada kulit atau kain tipis." },
      { label: "Alas Kaki", text: "Gunakan alas kaki harian standar Anda. Hindari telanjang kaki atau hak tinggi yang signifikan karena mengubah kinematika gaya berjalan." },
      { label: "Permukaan Jalan", text: "Lakukan latihan berjalan di permukaan datar dan keras. Hindari karpet, kerikil, atau medan berbukit saat registrasi awal." },
      { label: "Kecepatan Berjalan", text: "Pertahankan kecepatan berjalan santai alami Anda. Jangan berlari, menggeser kaki, atau sengaja mengubah ritme langkah." },
      { label: "Jendela Latihan", text: "Sistem memerlukan 10 jendela gaya berjalan yang tervalidasi (~2 m per jendela). Selesaikan tanpa berhenti di tengah sesi." },
      { label: "Registrasi Ulang", text: "Lakukan registrasi ulang setelah pergantian alas kaki signifikan, pemulihan cedera, atau perubahan posisi perangkat." },
    ],
  },
  authentication: {
    icon: Shield,
    accent: "#16A34A",
    accentBg: "#F0FDF4",
    accentBorder: "#BBF7D0",
    title: "Panduan Batasan Gaya Berjalan",
    subtitle: "ATURAN AUTENTIKASI & KENDALA SISTEM",
    bullets: [
      { label: "Jangkauan BLE", text: "Tetap dalam jangkauan BLE 3 m dari unit Smart Key. Hilangnya sinyal di tengah sesi akan memicu pembatalan otomatis." },
      { label: "Penempatan Konsisten", text: "Sensor harus dipakai di posisi yang sama seperti saat registrasi. Menaruh di saku atau tas tidak didukung." },
      { label: "Ambang Kepercayaan", text: "Autentikasi memerlukan skor kepercayaan ≥ 85% di 4 jendela yang tervalidasi. Skor lebih rendah memicu permintaan ulang." },
      { label: "Pembaruan Inkremental", text: "Autentikasi berhasil akan menyempurnakan model personalisasi Anda sebesar ±0,05 per sesi. Ini adalah perilaku normal." },
      { label: "Gangguan Lingkungan", text: "Hindari area ramai dengan kontak fisik saat pemindaian — benturan dan dorongan merusak sinyal akselerometer." },
      { label: "Batas Waktu Sesi", text: "Sesi aktif berakhir setelah 60 detik tidak aktif. Ketuk MULAI AUTENTIKASI untuk memulai sesi baru." },
    ],
  },
};

const MONO = "JetBrains Mono, monospace";
const SANS = "Inter, sans-serif";

export function GuidelineDialog({ open, type, onClose }: GuidelineDialogProps) {
  const data = type ? CONTENT[type] : null;

  return (
    <AnimatePresence>
      {open && data && (
        <motion.div
          className="absolute inset-0 z-30 flex items-center justify-center px-5"
          style={{ background: "rgba(30,41,59,0.4)", backdropFilter: "blur(4px)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-sm rounded-2xl overflow-hidden"
            style={{
              background: "#FFFFFF",
              boxShadow: "0 20px 60px rgba(30,41,59,0.2), 0 4px 16px rgba(30,41,59,0.08)",
              border: "1px solid #E2E8F0",
            }}
            initial={{ scale: 0.94, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.94, opacity: 0, y: 16 }}
            transition={{ type: "spring", damping: 26, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 pt-5 pb-4" style={{ borderBottom: "1px solid #F1F5F9" }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: data.accentBg, border: `1px solid ${data.accentBorder}` }}
                  >
                    <data.icon size={17} style={{ color: data.accent }} />
                  </div>
                  <div>
                    <h2 style={{ color: "#1E293B", fontFamily: SANS, fontWeight: 700, fontSize: "0.85rem", lineHeight: 1.3 }}>
                      {data.title}
                    </h2>
                    <p style={{ color: data.accent, fontFamily: MONO, fontSize: "0.58rem", marginTop: 2, letterSpacing: "0.08em" }}>
                      {data.subtitle}
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 transition-colors"
                  style={{ background: "#F1F5F9", color: "#64748B" }}
                >
                  <X size={13} />
                </button>
              </div>
            </div>

            {/* Bullets */}
            <div className="px-5 py-4 space-y-3 overflow-y-auto" style={{ maxHeight: "55vh" }}>
              {data.bullets.map((b, i) => (
                <div key={i} className="flex gap-3">
                  <div
                    className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: data.accent }}
                  />
                  <div>
                    <p style={{ color: data.accent, fontFamily: MONO, fontWeight: 700, fontSize: "0.66rem" }}>
                      {b.label}
                    </p>
                    <p style={{ color: "#64748B", fontFamily: SANS, fontSize: "0.72rem", marginTop: 2, lineHeight: 1.5 }}>
                      {b.text}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="px-5 pb-5 pt-2">
              <button
                onClick={onClose}
                className="w-full py-3 rounded-xl transition-all active:scale-[0.98]"
                style={{
                  background: data.accentBg,
                  border: `1px solid ${data.accentBorder}`,
                  color: data.accent,
                  fontFamily: MONO,
                  fontWeight: 700,
                  fontSize: "0.7rem",
                  letterSpacing: "0.1em",
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
