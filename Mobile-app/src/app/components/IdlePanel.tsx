import { ShieldCheck, Bluetooth, Sparkles } from "lucide-react";
import { motion } from "motion/react";

interface IdlePanelProps {
  isConnected: boolean;
  isDevMode?: boolean;
}

const MONO = "JetBrains Mono, monospace";
const SANS = "Inter, sans-serif";

export function IdlePanel({ isConnected, isDevMode }: IdlePanelProps) {
  return (
    <div
      className="rounded-2xl overflow-hidden flex flex-col"
      style={{
        background: "#FFFFFF",
        border: "1px solid #E2E8F0",
        boxShadow: "0 2px 12px rgba(30,41,59,0.06)",
      }}
    >
      {/* Top Header Bar */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "1px solid #F1F5F9" }}
      >
        <div className="flex items-center gap-2">
          <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.12em", textTransform: "uppercase" }}>
            STATUS SISTEM · Unit A7
          </p>
          {isDevMode && (
            <span
              className="px-1.5 py-0.5 rounded text-[0.52rem] font-bold"
              style={{ background: "#FEF3C7", color: "#D97706", border: "1px solid #FDE68A", fontFamily: MONO }}
            >
              DEV MODE
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="h-2 w-2 rounded-full"
            style={{
              background: isConnected ? "#16A34A" : "#94A3B8",
              boxShadow: isConnected ? "0 0 6px #16A34A80" : "none",
            }}
          />
          <p style={{ color: isConnected ? "#16A34A" : "#94A3B8", fontFamily: MONO, fontSize: "0.58rem", fontWeight: 600 }}>
            {isConnected ? "SIAGA" : "OFFLINE"}
          </p>
        </div>
      </div>

      {/* Main Content Body */}
      <div
        className="flex flex-col items-center justify-center text-center p-8 min-h-[220px]"
        style={{ background: "#FAFBFF" }}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 relative"
          style={{
            background: isConnected ? "linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)" : "#F1F5F9",
            border: `1.5px solid ${isConnected ? "#BFDBFE" : "#E2E8F0"}`,
            boxShadow: isConnected ? "0 4px 14px rgba(37,99,235,0.12)" : "none",
          }}
        >
          {isConnected ? (
            <ShieldCheck size={32} style={{ color: "#2563EB" }} />
          ) : (
            <Bluetooth size={28} style={{ color: "#94A3B8" }} />
          )}
        </motion.div>

        <h3
          style={{
            color: "#1E293B",
            fontFamily: SANS,
            fontSize: "0.92rem",
            fontWeight: 700,
            letterSpacing: "-0.01em",
          }}
        >
          {isConnected ? "Sistem Siaga & Siap Digunakan" : "Smart Key Belum Terhubung"}
        </h3>

        <p
          className="mt-1.5 max-w-xs text-center"
          style={{
            color: "#64748B",
            fontFamily: SANS,
            fontSize: "0.75rem",
            lineHeight: 1.45,
          }}
        >
          {isConnected
            ? "Silakan pilih salah satu operasi di bawah untuk memulai autentikasi atau pendaftaran profil."
            : "Sambungkan Bluetooth ke perangkat Smart Key terlebih dahulu sebelum memulai operasi."}
        </p>

        <div
          className="mt-4 px-3.5 py-1.5 rounded-full flex items-center gap-1.5"
          style={{
            background: "#FFFFFF",
            border: "1px solid #E2E8F0",
            boxShadow: "0 1px 4px rgba(30,41,59,0.04)",
          }}
        >
          <Sparkles size={12} style={{ color: "#2563EB" }} />
          <span style={{ color: "#475569", fontFamily: MONO, fontSize: "0.62rem", fontWeight: 600 }}>
            PILIH OPERASI DI BAWAH
          </span>
        </div>
      </div>
    </div>
  );
}
