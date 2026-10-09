"use client";

import { useEffect, useState, useCallback, createContext, useContext } from "react";
import { CheckCircle2, XCircle, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastTone = "success" | "error" | "warning";

type ToastItem = {
  id: number;
  tone: ToastTone;
  message: string;
};

type ToastContextValue = {
  showToast: (tone: ToastTone, message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

/** How long a toast stays on screen before it dismisses itself. */
const AUTO_DISMISS_MS = 4500;

const countdownTone: Record<ToastTone, string> = {
  success: "bg-emerald-500",
  error: "bg-red-500",
  warning: "bg-amber-500",
};

let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((tone: ToastTone, message: string) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, tone, message }]);
  }, []);

  function removeToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: number) => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger enter animation
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(toast.id), 200);
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const icons: Record<ToastTone, React.ReactNode> = {
    success: <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />,
    error: <XCircle className="h-5 w-5 shrink-0 text-red-500" />,
    warning: <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />,
  };

  return (
    <div
      role={toast.tone === "error" ? "alert" : "status"}
      className={cn(
        "relative flex items-start gap-3 overflow-hidden rounded-xl border px-4 py-3 shadow-lg transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:translate-x-0 motion-reduce:transition-opacity",
        visible ? "translate-x-0 opacity-100" : "translate-x-6 opacity-0",
        toast.tone === "success" &&
          "border-emerald-200 bg-white text-slate-800",
        toast.tone === "error" && "border-red-200 bg-white text-slate-800",
        toast.tone === "warning" && "border-amber-200 bg-white text-slate-800"
      )}
    >
      {icons[toast.tone]}
      <p className="flex-1 text-sm font-medium">{toast.message}</p>
      <button
        type="button"
        onClick={() => {
          setVisible(false);
          setTimeout(() => onDismiss(toast.id), 200);
        }}
        className="shrink-0 rounded-md p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      >
        <X className="h-4 w-4" />
      </button>
      {/* Shows how long the toast has left; it matches the auto-dismiss timer. */}
      <span
        aria-hidden="true"
        style={{ animationDuration: `${AUTO_DISMISS_MS}ms` }}
        className={cn(
          "toast-countdown absolute inset-x-0 bottom-0 h-[3px]",
          countdownTone[toast.tone]
        )}
      />
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}
