"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api-client";
import { enqueueAlerts, removeAlert } from "@/lib/alert-queue";
import type { AlertView } from "@/components/alerts/alert-archive";
import { X } from "lucide-react";

interface ToastAlert {
  alert: AlertView;
  id: number;
  visible: boolean;
}

export function AlertToast() {
  const [toasts, setToasts] = useState<ToastAlert[]>([]);
  const [ackError, setAckError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shownIds = useRef(new Set<number>());
  const toastIdCounter = useRef(0);

  const offer = useCallback((incoming: AlertView[]) => {
    setToasts((currentToasts) => {
      const newToasts: ToastAlert[] = [];
      for (const alert of incoming) {
        if (!shownIds.current.has(alert.id)) {
          shownIds.current.add(alert.id);
          newToasts.push({
            alert,
            id: ++toastIdCounter.current,
            visible: true,
          });
        }
      }
      if (newToasts.length === 0) return currentToasts;
      return [...currentToasts, ...newToasts];
    });
  }, []);

  // Native push events
  useEffect(() => {
    const handler = (event: Event) => {
      const nativeAlert = (event as CustomEvent<AlertView>).detail;
      if (nativeAlert?.id) offer([nativeAlert]);
    };
    window.addEventListener("native-push-received", handler as EventListener);
    return () => window.removeEventListener("native-push-received", handler as EventListener);
  }, [offer]);

  // Poll for active alerts
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      const result = await apiRequest<{ alerts: AlertView[] }>("/api/v1/alerts?active=true");
      if (cancelled || !result.success) return;
      offer(result.data.alerts);
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 20000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [offer]);

  const dismiss = useCallback((toastId: number, acknowledge = false) => {
    setToasts((prev) => {
      const toast = prev.find((t) => t.id === toastId);
      if (!toast) return prev;
      
      if (acknowledge) {
        // Acknowledge via API
        apiRequest(`/api/v1/alerts/${toast.alert.id}/acknowledge`, { method: "POST" });
      }
      
      return prev.filter((t) => t.id !== toastId);
    });
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-full max-w-md pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto animate-slide-in-right ${
            toast.alert.severity === "CRITICAL"
              ? "bg-red-600 border-red-700"
              : toast.alert.severity === "WARNING"
              ? "bg-amber-600 border-amber-700"
              : "bg-blue-600 border-blue-700"
          } text-white rounded-xl border-2 shadow-2xl p-4 w-full max-w-md`}
          role="alert"
          aria-live="assertive"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold ${
                    toast.alert.severity === "CRITICAL"
                      ? "bg-red-800"
                      : toast.alert.severity === "WARNING"
                      ? "bg-amber-800"
                      : "bg-blue-800"
                  }`}
                >
                  {toast.alert.severity}
                </span>
                <h3 className="font-bold text-lg truncate">{toast.alert.title}</h3>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{toast.alert.message}</p>
            </div>
            <button
              onClick={() => dismiss(toast.id)}
              className="flex-shrink-0 p-1 rounded-lg hover:bg-white/20 transition-colors"
              aria-label="Dismiss"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          
          <div className="flex gap-2 pt-2 border-t border-white/20">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1"
              onClick={() => dismiss(toast.id, true)}
            >
              OK, I understand
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1"
              onClick={() => dismiss(toast.id, false)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}