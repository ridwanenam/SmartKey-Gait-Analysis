import React, { createContext, useContext, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X, Trash2, Edit3 } from "lucide-react";
import { Toaster, toast } from "sonner";

export type DialogVariant = "info" | "success" | "warning" | "error" | "danger";

export interface AlertOptions {
  title?: string;
  message: string;
  type?: DialogVariant;
  confirmText?: string;
}

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  type?: DialogVariant;
}

export interface PromptOptions {
  title?: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
}

interface DialogState {
  isOpen: boolean;
  mode: "alert" | "confirm" | "prompt";
  title: string;
  message: string;
  type: DialogVariant;
  confirmText: string;
  cancelText: string;
  danger: boolean;
  defaultValue: string;
  placeholder: string;
  resolve?: (value: any) => void;
}

interface CustomDialogContextType {
  showAlert: (options: AlertOptions | string) => Promise<void>;
  showConfirm: (options: ConfirmOptions | string) => Promise<boolean>;
  showPrompt: (options: PromptOptions | string) => Promise<string | null>;
  toast: typeof toast;
}

const CustomDialogContext = createContext<CustomDialogContextType | null>(null);

// Singleton service untuk pemanggilan dari luar React komponen (e.g. static services)
export const dialogService = {
  alert: async (_options: AlertOptions | string): Promise<void> => {},
  confirm: async (_options: ConfirmOptions | string): Promise<boolean> => false,
  prompt: async (_options: PromptOptions | string): Promise<string | null> => null,
  toast,
};

const MONO = "JetBrains Mono, monospace";
const SANS = "Inter, sans-serif";

export const CustomDialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [dialog, setDialog] = useState<DialogState>({
    isOpen: false,
    mode: "alert",
    title: "",
    message: "",
    type: "info",
    confirmText: "Mengerti",
    cancelText: "Batal",
    danger: false,
    defaultValue: "",
    placeholder: "",
  });

  const [promptInput, setPromptInput] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  const showAlert = useCallback((options: AlertOptions | string): Promise<void> => {
    return new Promise((resolve) => {
      const opts: AlertOptions = typeof options === "string" ? { message: options } : options;
      setDialog({
        isOpen: true,
        mode: "alert",
        title: opts.title || (opts.type === "error" || opts.type === "danger" ? "Peringatan" : opts.type === "success" ? "Berhasil" : "Informasi"),
        message: opts.message,
        type: opts.type || "info",
        confirmText: opts.confirmText || "Mengerti",
        cancelText: "Tutup",
        danger: opts.type === "error" || opts.type === "danger",
        defaultValue: "",
        placeholder: "",
        resolve,
      });
    });
  }, []);

  const showConfirm = useCallback((options: ConfirmOptions | string): Promise<boolean> => {
    return new Promise((resolve) => {
      const opts: ConfirmOptions = typeof options === "string" ? { message: options } : options;
      setDialog({
        isOpen: true,
        mode: "confirm",
        title: opts.title || "Konfirmasi Tindakan",
        message: opts.message,
        type: opts.type || (opts.danger ? "danger" : "info"),
        confirmText: opts.confirmText || (opts.danger ? "Ya, Hapus" : "Lanjutkan"),
        cancelText: opts.cancelText || "Batal",
        danger: Boolean(opts.danger),
        defaultValue: "",
        placeholder: "",
        resolve,
      });
    });
  }, []);

  const showPrompt = useCallback((options: PromptOptions | string): Promise<string | null> => {
    return new Promise((resolve) => {
      const opts: PromptOptions = typeof options === "string" ? { title: options } : options;
      const initialVal = opts.defaultValue || "";
      setPromptInput(initialVal);
      setDialog({
        isOpen: true,
        mode: "prompt",
        title: opts.title || "Input Teks",
        message: opts.message || "",
        type: "info",
        confirmText: opts.confirmText || "Simpan",
        cancelText: opts.cancelText || "Batal",
        danger: false,
        defaultValue: initialVal,
        placeholder: opts.placeholder || "Ketik di sini...",
        resolve,
      });
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 80);
    });
  }, []);

  // Hubungkan singleton dialogService ke implementasi aktif
  dialogService.alert = showAlert;
  dialogService.confirm = showConfirm;
  dialogService.prompt = showPrompt;
  dialogService.toast = toast;

  const handleClose = (result: any) => {
    const resFn = dialog.resolve;
    setDialog((prev) => ({ ...prev, isOpen: false }));
    if (resFn) {
      resFn(result);
    }
  };

  const handleConfirm = () => {
    if (dialog.mode === "prompt") {
      handleClose(promptInput);
    } else if (dialog.mode === "confirm") {
      handleClose(true);
    } else {
      handleClose(undefined);
    }
  };

  const handleCancel = () => {
    if (dialog.mode === "prompt") {
      handleClose(null);
    } else if (dialog.mode === "confirm") {
      handleClose(false);
    } else {
      handleClose(undefined);
    }
  };

  const getIcon = () => {
    if (dialog.danger || dialog.type === "danger" || dialog.type === "error") {
      return (
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center bg-rose-50 border border-rose-200 text-rose-600 shrink-0">
          {dialog.mode === "confirm" ? <Trash2 size={20} /> : <AlertTriangle size={20} />}
        </div>
      );
    }
    if (dialog.type === "warning") {
      return (
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center bg-amber-50 border border-amber-200 text-amber-600 shrink-0">
          <AlertCircle size={20} />
        </div>
      );
    }
    if (dialog.type === "success") {
      return (
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center bg-emerald-50 border border-emerald-200 text-emerald-600 shrink-0">
          <CheckCircle2 size={20} />
        </div>
      );
    }
    if (dialog.mode === "prompt") {
      return (
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center bg-blue-50 border border-blue-200 text-blue-600 shrink-0">
          <Edit3 size={20} />
        </div>
      );
    }
    return (
      <div className="w-10 h-10 rounded-2xl flex items-center justify-center bg-blue-50 border border-blue-200 text-blue-600 shrink-0">
        <Info size={20} />
      </div>
    );
  };

  return (
    <CustomDialogContext.Provider value={{ showAlert, showConfirm, showPrompt, toast }}>
      {children}
      <Toaster
        position="top-center"
        richColors
        closeButton
        toastOptions={{
          style: {
            fontFamily: SANS,
            borderRadius: "1rem",
            border: "1px solid #E2E8F0",
            boxShadow: "0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)",
          },
        }}
      />

      <AnimatePresence>
        {dialog.isOpen && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
            {/* Backdrop Blur */}
            <motion.div
              className="fixed inset-0"
              style={{ background: "rgba(15,23,42,0.55)", backdropFilter: "blur(6px)" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleCancel}
            />

            {/* Modal Card */}
            <motion.div
              className="relative w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl flex flex-col z-10 bg-white border border-slate-200"
              initial={{ scale: 0.93, opacity: 0, y: 16 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.93, opacity: 0, y: 16 }}
              transition={{ type: "spring", damping: 26, stiffness: 320 }}
            >
              {/* Header */}
              <div className="px-5 py-4 flex items-start justify-between border-b border-slate-100 bg-slate-50/60">
                <div className="flex items-center gap-3">
                  {getIcon()}
                  <div>
                    <h3 style={{ color: "#0F172A", fontFamily: SANS, fontWeight: 700, fontSize: "0.95rem", lineHeight: 1.25 }}>
                      {dialog.title}
                    </h3>
                    <p style={{ color: "#64748B", fontFamily: MONO, fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: "2px" }}>
                      SmartKey System Dialog
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleCancel}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 transition-all cursor-pointer"
                  title="Tutup"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Body */}
              <div className="p-5 flex flex-col gap-3.5">
                {dialog.message && (
                  <p
                    className="text-slate-600 text-[0.82rem] leading-relaxed whitespace-pre-line"
                    style={{ fontFamily: SANS }}
                  >
                    {dialog.message}
                  </p>
                )}

                {/* Prompt Input Field */}
                {dialog.mode === "prompt" && (
                  <div className="flex flex-col gap-1.5 mt-1">
                    <div className="relative">
                      <input
                        ref={inputRef}
                        type="text"
                        value={promptInput}
                        onChange={(e) => setPromptInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleConfirm();
                          if (e.key === "Escape") handleCancel();
                        }}
                        placeholder={dialog.placeholder}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none text-slate-800 text-[0.84rem] transition-all bg-white shadow-xs"
                        style={{ fontFamily: SANS }}
                      />
                      {promptInput && (
                        <button
                          type="button"
                          onClick={() => setPromptInput("")}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Footer Buttons */}
              <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50/40 flex items-center justify-end gap-2">
                {dialog.mode !== "alert" && (
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-white active:scale-95 text-[0.78rem] font-semibold transition-all cursor-pointer"
                    style={{ fontFamily: SANS }}
                  >
                    {dialog.cancelText}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleConfirm}
                  className={`px-4 py-2 rounded-xl text-white active:scale-95 text-[0.78rem] font-semibold transition-all shadow-xs cursor-pointer ${
                    dialog.danger
                      ? "bg-rose-600 hover:bg-rose-700"
                      : "bg-blue-600 hover:bg-blue-700"
                  }`}
                  style={{ fontFamily: SANS }}
                >
                  {dialog.confirmText}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </CustomDialogContext.Provider>
  );
};

export const useDialog = () => {
  const context = useContext(CustomDialogContext);
  if (!context) {
    throw new Error("useDialog must be used within a CustomDialogProvider");
  }
  return context;
};

