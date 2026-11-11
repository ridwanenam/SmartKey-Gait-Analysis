import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Bluetooth, RefreshCw, X, Check, Lock, Activity, Wifi, AlertCircle } from "lucide-react";
import { BleClient } from "@capacitor-community/bluetooth-le";
import { useBLE } from "../context/BLEContext";

interface DiscoveredDevice {
  deviceId: string;
  name: string;
  rssi?: number;
  type: "wearable" | "doorlock" | "other";
  lastSeen: number;
}

interface BLEScanModalProps {
  open: boolean;
  onClose: () => void;
  targetType?: "wearable" | "doorlock" | "all";
}

const SMART_KEY_SERVICE_UUID = "19b10000-e8f2-537e-4f6c-d104768a1214";
const MONO = "JetBrains Mono, monospace";
const SANS = "Inter, sans-serif";

export const BLEScanModal: React.FC<BLEScanModalProps> = ({
  open,
  onClose,
  targetType = "all",
}) => {
  const {
    wearableState,
    doorLockState,
    performWearableConnection,
    performDoorLockConnection,
  } = useBLE();

  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectedId, setConnectedId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const scanTimeoutRef = useRef<any>(null);

  const startScan = useCallback(async () => {
    setErrorMsg(null);
    setDevices([]);
    setIsScanning(true);

    try {
      await BleClient.initialize();
      try {
        await BleClient.stopLEScan();
      } catch (_) {}

      await BleClient.requestLEScan(
        { services: [SMART_KEY_SERVICE_UUID] },
        (result) => {
          if (!result.device) return;
          const devName = result.device.name || result.localName || "SmartKey Unknown";
          const devId = result.device.deviceId;
          const rssi = result.rssi;

          let type: "wearable" | "doorlock" | "other" = "other";
          if (devName.includes("DoorLock")) {
            type = "doorlock";
          } else if (devName.includes("Wearable") || devName.includes("SmartKey")) {
            type = "wearable";
          }

          setDevices((prev) => {
            const existingIndex = prev.findIndex((d) => d.deviceId === devId);
            const item: DiscoveredDevice = {
              deviceId: devId,
              name: devName,
              rssi,
              type,
              lastSeen: Date.now(),
            };
            if (existingIndex >= 0) {
              const updated = [...prev];
              updated[existingIndex] = item;
              return updated;
            }
            return [...prev, item];
          });
        }
      );

      // Batasi pemindaian aktif selama 10 detik per siklus
      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = setTimeout(async () => {
        try {
          await BleClient.stopLEScan();
        } catch (_) {}
        setIsScanning(false);
      }, 10000);
    } catch (err: any) {
      console.error("[BLEScanModal] Gagal memulai scan:", err);
      setIsScanning(false);
      setErrorMsg(err?.message || "Gagal menginisialisasi Bluetooth. Pastikan Bluetooth aktif dan izin diberikan.");
    }
  }, []);

  const stopScan = useCallback(async () => {
    if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
    try {
      await BleClient.stopLEScan();
    } catch (_) {}
    setIsScanning(false);
  }, []);

  useEffect(() => {
    if (open) {
      startScan();
    } else {
      stopScan();
      setConnectingId(null);
      setConnectedId(null);
    }
    return () => {
      stopScan();
    };
  }, [open, startScan, stopScan]);

  const handleConnect = async (device: DiscoveredDevice) => {
    setConnectingId(device.deviceId);
    setErrorMsg(null);
    await stopScan();

    try {
      if (device.type === "doorlock") {
        await performDoorLockConnection({ deviceId: device.deviceId, name: device.name });
      } else {
        await performWearableConnection({ deviceId: device.deviceId, name: device.name });
      }
      setConnectedId(device.deviceId);
      // Auto tutup modal setelah berhasil terhubung
      setTimeout(() => {
        onClose();
      }, 800);
    } catch (err: any) {
      console.error("[BLEScanModal] Koneksi gagal:", err);
      setErrorMsg(`Gagal menghubungkan ke ${device.name}: ${err?.message || "Koneksi timeout"}`);
    } finally {
      setConnectingId(null);
    }
  };

  const filteredDevices = devices.filter((d) => {
    if (targetType === "wearable") return d.type === "wearable" || d.type === "other";
    if (targetType === "doorlock") return d.type === "doorlock" || d.type === "other";
    return true;
  });

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[9990] flex items-center justify-center p-4">
          {/* Backdrop Blur */}
          <motion.div
            className="fixed inset-0"
            style={{ background: "rgba(15,23,42,0.55)", backdropFilter: "blur(6px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Modal Container */}
          <motion.div
            className="relative w-full max-w-md rounded-2xl overflow-hidden shadow-2xl flex flex-col z-10 bg-white border border-slate-200"
            initial={{ scale: 0.93, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.93, opacity: 0, y: 16 }}
            transition={{ type: "spring", damping: 26, stiffness: 320 }}
          >
            {/* Header */}
            <div className="px-5 py-4 flex items-center justify-between border-b border-slate-100 bg-slate-50/70">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl flex items-center justify-center bg-blue-50 border border-blue-200 text-blue-600 shrink-0">
                  <Bluetooth size={20} className={isScanning ? "animate-pulse" : ""} />
                </div>
                <div>
                  <h3 style={{ color: "#0F172A", fontFamily: SANS, fontWeight: 700, fontSize: "0.95rem" }}>
                    {targetType === "wearable"
                      ? "Pindai Wearable RP2040"
                      : targetType === "doorlock"
                      ? "Pindai Solenoid Door Lock"
                      : "Pindai Perangkat SmartKey"}
                  </h3>
                  <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {isScanning ? "Mencari Sinyal Bluetooth..." : "Pemindaian Selesai"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={startScan}
                  disabled={isScanning}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:text-slate-700 hover:bg-slate-200/60 transition-all cursor-pointer disabled:opacity-40"
                  title="Pindai Ulang"
                >
                  <RefreshCw size={14} className={isScanning ? "animate-spin text-blue-600" : ""} />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-all cursor-pointer"
                  title="Tutup"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Scanning Status Banner */}
            <div className="px-5 py-2.5 bg-blue-50/40 border-b border-blue-100/60 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  {isScanning && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                  )}
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${isScanning ? "bg-blue-600" : "bg-slate-400"}`} />
                </span>
                <span style={{ color: "#334155", fontFamily: MONO, fontSize: "0.68rem" }}>
                  {isScanning ? "Sedang memindai perangkat BLE di sekitar..." : `${filteredDevices.length} perangkat ditemukan`}
                </span>
              </div>
              {isScanning && (
                <button
                  type="button"
                  onClick={stopScan}
                  className="text-[0.65rem] font-semibold text-blue-600 hover:text-blue-800"
                  style={{ fontFamily: MONO }}
                >
                  Hentikan
                </button>
              )}
            </div>

            {/* Device List Body */}
            <div className="p-4 flex flex-col gap-2.5 max-h-72 overflow-y-auto">
              {errorMsg && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-2.5 text-rose-700 text-xs">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <span style={{ fontFamily: SANS }}>{errorMsg}</span>
                </div>
              )}

              {filteredDevices.length === 0 ? (
                <div className="py-8 flex flex-col items-center justify-center text-center gap-2">
                  <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                    <Wifi size={22} className={isScanning ? "animate-pulse" : ""} />
                  </div>
                  <p style={{ color: "#64748B", fontFamily: SANS, fontSize: "0.82rem", fontWeight: 500 }}>
                    {isScanning ? "Mendeteksi perangkat Bluetooth..." : "Tidak ada perangkat SmartKey terdeteksi"}
                  </p>
                  <p style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.65rem", maxWidth: "260px" }}>
                    Pastikan Arduino Nano RP2040 atau ESP32 menyala dan berada dalam jarak dekat.
                  </p>
                </div>
              ) : (
                filteredDevices.map((dev) => {
                  const isConnecting = connectingId === dev.deviceId;
                  const isConnected = connectedId === dev.deviceId;
                  const isDoor = dev.type === "doorlock";

                  return (
                    <div
                      key={dev.deviceId}
                      className="p-3 rounded-xl border border-slate-200/80 hover:border-slate-300 bg-white hover:bg-slate-50/60 transition-all flex items-center justify-between gap-3 shadow-xs"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                            isDoor
                              ? "bg-emerald-50 border-emerald-200 text-emerald-600"
                              : "bg-blue-50 border-blue-200 text-blue-600"
                          }`}
                        >
                          {isDoor ? <Lock size={16} /> : <Activity size={16} />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="font-bold text-slate-800 text-[0.84rem] truncate"
                              style={{ fontFamily: SANS }}
                            >
                              {dev.name}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[0.56rem] font-bold tracking-wider uppercase border ${
                                isDoor
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-blue-50 text-blue-700 border-blue-200"
                              }`}
                              style={{ fontFamily: MONO }}
                            >
                              {isDoor ? "Door Lock" : "Wearable"}
                            </span>
                          </div>
                          <p
                            className="text-slate-400 text-[0.62rem] truncate"
                            style={{ fontFamily: MONO }}
                          >
                            {dev.deviceId} {dev.rssi !== undefined ? `| ${dev.rssi} dBm` : ""}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleConnect(dev)}
                        disabled={Boolean(connectingId) || isConnected}
                        className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all shrink-0 active:scale-95 cursor-pointer flex items-center gap-1.5 shadow-xs ${
                          isConnected
                            ? "bg-emerald-600 text-white"
                            : isDoor
                            ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                            : "bg-blue-600 hover:bg-blue-700 text-white"
                        } disabled:opacity-50`}
                        style={{ fontFamily: SANS }}
                      >
                        {isConnecting ? (
                          <>
                            <RefreshCw size={12} className="animate-spin" />
                            <span>Koneksi...</span>
                          </>
                        ) : isConnected ? (
                          <>
                            <Check size={14} />
                            <span>Terhubung</span>
                          </>
                        ) : (
                          <span>Hubungkan</span>
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <span style={{ color: "#94A3B8", fontFamily: MONO, fontSize: "0.62rem" }}>
                UUID: {SMART_KEY_SERVICE_UUID.substring(0, 8)}...
              </span>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-white active:scale-95 text-[0.78rem] font-semibold transition-all cursor-pointer"
                style={{ fontFamily: SANS }}
              >
                Tutup
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

