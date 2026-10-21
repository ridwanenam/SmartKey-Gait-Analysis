import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Shield, Info, BookOpen, Activity } from "lucide-react";

interface GuidelineDialogProps {
  open: boolean;
  onClose: () => void;
  defaultTab?: "registration" | "authentication" | "metrics";
}

interface BulletItem {
  label: string;
  text: string;
  indicator?: string;
}

interface TabContent {
  icon: typeof Info;
  accent: string;
  accentBg: string;
  accentBorder: string;
  title: string;
  subtitle: string;
  bullets: BulletItem[];
}

const CONTENT: Record<"registration" | "authentication" | "metrics", TabContent> = {
  registration: {
    icon: Info,
    accent: "#2563EB",
    accentBg: "#EFF6FF",
    accentBorder: "#BFDBFE",
    title: "Panduan Sesi Registrasi",
    subtitle: "PENDAFTARAN AWAL PROFIL GAIT (EDGE TRAINING)",
    bullets: [
      {
        label: "Penempatan Sensor di Saku",
        text: "Letakkan unit Smart Key di dalam saku celana (depan atau belakang). Pastikan orientasi stabil dan tidak berputar bebas di dalam saku.",
      },
      {
        label: "Penyelarasan Saku Otomatis (500 ms)",
        text: "Saat tombol registrasi ditekan, sistem secara otomatis menyelaraskan sudut kemiringan saku celana (Roll & Pitch) dalam 500 ms pertama tanpa perlu menunggu lama.",
        indicator: "Cukup diam natural selama ~0.5 detik pertama sebelum mulai melangkah.",
      },
      {
        label: "Alas Kaki & Permukaan Jalan",
        text: "Gunakan alas kaki harian standar Anda (sepatu/sandal). Lakukan di permukaan datar tanpa sengaja mengubah kecepatan atau gaya berjalan.",
      },
      {
        label: "Karakteristik Langkah Nyata",
        text: "Berjalanlah secara santai dan konstan (1-2 langkah/detik). Sistem menggunakan penapis ZUPT untuk memastikan hanya langkah kaki murni yang diproses.",
      },
      {
        label: "Target Kuota 5 Jendela Valid",
        text: "Sistem mengumpulkan 5 jendela data valid (masing-masing 1.5 detik @ 100 Hz IMU). Selesaikan rangkaian jalan hingga progres mencapai kuota 5/5 (~7.5 detik total).",
        indicator: "Jendela yang dideteksi diam/noise otomatis diabaikan tanpa membatalkan langkah valid yang sudah terkumpul.",
      },
      {
        label: "Penyimpanan Permanen ke Flash",
        text: "Setelah 5 jendela valid terpenuhi, model GHMM awal (distribusi Gaussian 5 state & 5 fitur) langsung dilatih dan disimpan permanen ke Flash KVStore internal RP2040.",
        indicator: "Data model tetap tersimpan aman di chip wearable meskipun daya baterai dimatikan.",
      },
    ],
  },
  authentication: {
    icon: Shield,
    accent: "#16A34A",
    accentBg: "#F0FDF4",
    accentBorder: "#BBF7D0",
    title: "Panduan Sesi Autentikasi",
    subtitle: "AKSES MASUK RUMAH OTOMATIS (EDGE INFERENCE)",
    bullets: [
      {
        label: "Pemrosesan Sambil Berjalan (On-the-Move)",
        text: "Pengguna cukup berjalan mendekati rumah. Smart Key di saku celana menyaring sinyal akselerasi-gyro dan mengumpulkan skor kecocokan forward GHMM.",
      },
      {
        label: "Penyelarasan Saku Instan (500 ms)",
        text: "Begitu sesi dimulai, sensor otomatis mengunci sudut kemiringan gravitasi saku secara instan (500 ms) sebelum mengevaluasi langkah.",
      },
      {
        label: "Ambang Batas Dinamis (Adaptive Threshold)",
        text: "Ambang batas toleransi disesuaikan otomatis mengikuti amplitudo langkah terakhir pengguna guna mengantisipasi kelelahan fisik atau variasi ritme harian.",
        indicator: "Nilai ambang bergeser mengikuti fluktuasi puncak energi langkah terakhir.",
      },
      {
        label: "Evaluasi Multiclass 1-vs-All",
        text: "Sistem mencocokkan pola langkah secara bersamaan terhadap seluruh slot pemilik yang terdaftar dan memilih profil dengan probabilitas tertinggi.",
      },
      {
        label: "Eksekusi Kunci Pintu Otomatis",
        text: "Saat akumulasi 5 jendela mencapai skor CIR ≥ 80.0%, perintah buka pintu langsung dikirim via BLE ke ESP32 dan relay solenoid aktif seketika.",
        indicator: "Pintu terbuka otomatis tanpa perlu mengeluarkan HP atau menempelkan kartu.",
      },
      {
        label: "Personalisasi Inkremental (Self-Adaptive EMA)",
        text: "Verifikasi yang memiliki keyakinan sangat tinggi (CIR ≥ 90.0%) memperbarui model biometrik di Flash memori via formula Exponential Moving Average (α = 0.15).",
      },
      {
        label: "Emergency Bypass (Cadangan Darurat)",
        text: "Jika pengguna cedera kaki berat atau sensor terkendala, buka menu Bypass di aplikasi dan masukkan 6 digit PIN darurat untuk membuka pintu (< 1 detik).",
      },
    ],
  },
  metrics: {
    icon: Activity,
    accent: "#7C3AED",
    accentBg: "#F5F3FF",
    accentBorder: "#DDD6FE",
    title: "Kamus Parameter & Metrik Log",
    subtitle: "PANDUAN INTERPRETASI DIAGNOSTIK KINEMATIKA & EDGE AI",
    bullets: [
      {
        label: "1. Skor Keyakinan (CIR - Confidence Indicator Ratio)",
        text: "Mengukur tingkat kemiripan relatif pola ayunan langkah terhadap profil biometrik pemilik via evaluasi Multiclass 1-vs-All GHMM. Berfungsi sebagai penentu utama apakah pintu berhak dibuka atau ditolak.",
        indicator: "Skala 0.0% s.d. 100.0%. Semakin mendekati 100% semakin cocok/identik. Pintu dibuka jika CIR ≥ 80.0%. Adaptasi model (EMA) aktif jika CIR ≥ 90.0%.",
      },
      {
        label: "2. Log-Likelihood (LL - ln αT / t Length-Normalized)",
        text: "Rata-rata probabilitas logaritmik rantai transisi dan emisi Gaussian forward pass per langkah sepanjang 2 state tersembunyi (Dual-Phase: Fase Tumpuan / Stance vs Fase Ayunan / Swing). Menunjukkan seberapa wajar urutan fase langkah terhadap model secara adil dan stabil.",
        indicator: "Nilai negatif skala logaritma natural (ln) per jendela. Semakin mendekati 0 (semakin tidak negatif), semakin tinggi kecocokannya. Contoh: -15.5 jauh lebih cocok dibanding -35.0. Nilai di bawah basis ambang dinamis diidentifikasi sebagai langkah asing/anomali.",
      },
      {
        label: "3. Ambang Batas Dinamis (Adaptive Threshold - Th)",
        text: "Ambang toleransi dinamis berbasis Peak Tracking (margin 1.15x) yang bergerak adaptif mengikuti intensitas langkah pengguna untuk mengantisipasi kelelahan otot atau perubahan ritme jalan harian.",
        indicator: "Bergerak dinamis mengikuti energi puncak langkah terakhir. Nilai Log-Likelihood langkah harus berada di atas ambang ini (LL ≥ Th) agar diakui sebagai langkah pemilik yang valid.",
      },
      {
        label: "4. Vektor Ciri: Rata-Rata Kecepatan Sudut (Mean Gyro - μ)",
        text: "Nilai tengah magnitude kecepatan sudut rotasi saku saat paha berayun. Menggambarkan intensitas kecepatan putaran paha per jendela gerak secara invarian terhadap orientasi sensor.",
        indicator: "Berkisar antara 40°/s s.d. 140°/s saat melangkah santai hingga wajar. Nilai di luar rentang ini menandakan gerakan pasif atau guncangan eksternal.",
      },
      {
        label: "5. Vektor Ciri: Variansi Putaran (Variance - σ²)",
        text: "Mengukur persebaran kuadratik tenaga putaran gyro. Menentukan kontras dinamika antara fase ayun cepat dan fase tumpuan diam.",
        indicator: "Rentang tipikal 400 s.d. 3500 (°/s)² pada jalan normal. Nilai < 100 berarti gerakan pasif / datar; nilai > 5000 menandakan putaran berlebihan atau lari kencang.",
      },
      {
        label: "6. Vektor Ciri: Keteraturan Irama Cadence (Cadence Regularity - R)",
        text: "Puncak koefisien autokorelasi (R_peak) sinyal giroskop yang mengukur konsistensi periodisitas tempo langkah kaki antar-fase tumpuan.",
        indicator: "Rentang tipikal 65% s.d. 95% pada langkah ritmis teratur. Nilai rendah (< 50%) menandakan langkah terhenti-henti, kaki tersandung, atau ayunan tangan acak.",
      },
      {
        label: "7. Vektor Ciri: Periode Siklus Langkah (Stride Period - k)",
        text: "Indeks lag waktu autokorelasi (k_peak) dari siklus langkah kaki penuh. Mewakili frekuensi langkah alami yang berkorelasi langsung dengan panjang tungkai dan tinggi badan individu (biometrik fisik bawaan unik).",
        indicator: "Rentang tipikal 45 s.d. 95 sampel @ 10ms (setara 0.45s s.d. 0.95s per langkah). Menggantikan skewness yang rentan derau kalkulasi.",
      },
      {
        label: "8. Vektor Ciri: Hentakan Kaki Dinamis (Heel-Strike Impact - Acc)",
        text: "RMS akselerasi linier dinamis |acc - 1.0g| yang mengukur besaran gaya reaksi tanah (Ground Reaction Force) saat tumit menapak permukaan lantai yang merambat ke paha. Menjadi pembeda mutlak antara langkah kaki nyata vs guncangan saku jaket atau ayunan tangan.",
        indicator: "Rentang tipikal 35 %g s.d. 85 %g saat melangkah di saku celana. Pada ayunan tangan atau saku jaket tanpa hentakan tanah, nilainya < 15 %g sehingga langsung ditolak oleh model.",
      },
      {
        label: "9. ZUPT (Zero Velocity Update - Filter Gerak Aktif)",
        text: "Penapisan kinematika berbasis energi rotasi gyro saku untuk memilah gerakan melangkah nyata dari kondisi diam, getaran kain saku, atau guncangan kendaraan.",
        indicator: "Ambang batas energi rotasi = 0.85 (rad/s)². Jika energi rotasi ≥ 0.85, status dinyatakan VALID (Melangkah) dan diteruskan ke GHMM; jika < 0.85, status DIAM dan jendela dibuang agar tidak merusak akurasi model.",
      },
      {
        label: "10. Personalisasi Inkremental (Δ EMA)",
        text: "Besaran koreksi pembaruan halus pada nilai rata-rata (means) model biometrik di flash memori via formula Exponential Moving Average (faktor pembobot α = 0.10). Matriks kovarian dibekukan saat adaptasi agar ambang batas (threshold) tidak hanyut (drift).",
        indicator: "Rentang koreksi tipikal ±0.001 s.d. ±0.025. Hanya aktif saat verifikasi sangat yakin (CIR ≥ 90.0%) DAN memiliki margin keunggulan bersih (Separation Margin ≥ 6.0%) terhadap slot pengguna lain untuk mencegah template poisoning.",
      },
      {
        label: "11. Kebebasan Orientasi Saku (100% Invarian Orientasi)",
        text: "Ekstraksi fitur beroperasi murni pada magnitude skalar kecepatan sudut dan deviasi percepatan terhadap gravitasi (|acc - 1.0g|), menjamin kebal penuh terhadap rotasi fisik 3D.",
        indicator: "Pengguna 100% bebas meletakkan kunci pintar dalam posisi apa pun di saku celana (tegak, miring, menyudut, maupun terbalik) tanpa memerlukan prosedur kalibrasi arah saku.",
      },
      {
        label: "12. Osiloskop Dual-Axis (Waveform 20 Hz Live BLE)",
        text: "Visualisasi kurva kinematika beresolusi tinggi (20 sampel/detik) untuk memverifikasi bentuk gelombang langkah kaki nyata secara visual.",
        indicator: "Kanal Hijau Neon (kiri): Akselerasi linier dinamis dalam satuan 'g' (pusat 0.0g). Kanal Kuning Amber (kanan): Energi rotasi gyro dalam satuan '(rad/s)²' dengan garis batas putus-putus 0.85 ZUPT.",
      },
    ],
  },
};

const MONO = "JetBrains Mono, monospace";
const SANS = "Inter, sans-serif";

export function GuidelineDialog({ open, onClose, defaultTab = "registration" }: GuidelineDialogProps) {
  const [tab, setTab] = useState<"registration" | "authentication" | "metrics">(defaultTab);

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
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 select-none"
          style={{ background: "rgba(30,41,59,0.55)", backdropFilter: "blur(5px)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-sm sm:max-w-md md:max-w-lg rounded-2xl overflow-hidden flex flex-col"
            style={{
              background: "#FFFFFF",
              boxShadow: "0 20px 60px rgba(30,41,59,0.2), 0 4px 16px rgba(30,41,59,0.08)",
              border: "1px solid #E2E8F0",
              maxHeight: "90vh",
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
                      KETENTUAN OPERASIONAL & METRIK GAIT
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

              {/* Segmented Tab Controls (3 Tab Bersih) */}
              <div className="flex p-1 rounded-xl bg-slate-100 gap-1 mt-3">
                <button
                  type="button"
                  onClick={() => setTab("registration")}
                  className={`flex-1 py-1.5 px-2 rounded-lg text-center transition-all flex items-center justify-center gap-1 cursor-pointer ${
                    tab === "registration"
                      ? "bg-white text-blue-600 shadow-xs font-bold"
                      : "text-slate-500 font-medium hover:text-slate-700"
                  }`}
                  style={{ fontFamily: MONO, fontSize: "0.62rem" }}
                >
                  <Info size={12} style={{ color: tab === "registration" ? "#2563EB" : "#64748B" }} />
                  <span>Registrasi</span>
                </button>

                <button
                  type="button"
                  onClick={() => setTab("authentication")}
                  className={`flex-1 py-1.5 px-2 rounded-lg text-center transition-all flex items-center justify-center gap-1 cursor-pointer ${
                    tab === "authentication"
                      ? "bg-white text-emerald-600 shadow-xs font-bold"
                      : "text-slate-500 font-medium hover:text-slate-700"
                  }`}
                  style={{ fontFamily: MONO, fontSize: "0.62rem" }}
                >
                  <Shield size={12} style={{ color: tab === "authentication" ? "#16A34A" : "#64748B" }} />
                  <span>Autentikasi</span>
                </button>

                <button
                  type="button"
                  onClick={() => setTab("metrics")}
                  className={`flex-1 py-1.5 px-2 rounded-lg text-center transition-all flex items-center justify-center gap-1 cursor-pointer ${
                    tab === "metrics"
                      ? "bg-white text-purple-600 shadow-xs font-bold"
                      : "text-slate-500 font-medium hover:text-slate-700"
                  }`}
                  style={{ fontFamily: MONO, fontSize: "0.62rem" }}
                >
                  <Activity size={12} style={{ color: tab === "metrics" ? "#7C3AED" : "#64748B" }} />
                  <span>Parameter Log</span>
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
                {tab === "registration" ? "MODE TRAINING" : tab === "authentication" ? "MODE REAL-TIME" : "KAMUS METRIK"}
              </span>
            </div>

            {/* Bullets List */}
            <div className="px-5 py-4 space-y-3.5 overflow-y-auto flex-1" style={{ maxHeight: "58vh" }}>
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
                    {b.indicator && (
                      <div
                        className="mt-1.5 px-2.5 py-1.5 rounded-lg text-[0.6rem] border"
                        style={{
                          background: "#F8FAFC",
                          borderColor: "#E2E8F0",
                          fontFamily: MONO,
                          color: "#334155",
                          lineHeight: 1.4,
                        }}
                      >
                        <span className="font-bold text-slate-800">Indikator Patokan:</span>{" "}
                        <span className="text-slate-600">{b.indicator}</span>
                      </div>
                    )}
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

