"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Info,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

export type SweetAlertTone = "info" | "success" | "warning" | "error" | "question";

type SweetAlertOptions = {
  /** The headline. Keep it short — it is read at a glance. */
  title: string;
  /** One or two sentences of detail under the headline. */
  text?: string;
  /** Label of the accepting button. Defaults per tone. */
  confirmLabel?: string;
  /** Label of the dismissing button; only `confirm()` shows one. */
  cancelLabel?: string;
  tone?: SweetAlertTone;
};

type SweetAlertContextValue = {
  /**
   * Informational popup with a single "OK" — the SweetAlert-style dialog the
   * desks use to confirm that a save, an approval or a rejection went through.
   * Resolves once the reader closes it.
   */
  alert: (options: SweetAlertOptions) => Promise<void>;
  /**
   * Yes/no popup. Resolves `true` only when the reader accepts, so destructive
   * or otherwise irreversible actions can wait for the answer.
   */
  confirm: (options: SweetAlertOptions) => Promise<boolean>;
};

const SweetAlertContext = createContext<SweetAlertContextValue | null>(null);

type PendingRequest = SweetAlertOptions & {
  kind: "alert" | "confirm";
  resolve: (accepted: boolean) => void;
};

const TONE_ICON: Record<SweetAlertTone, React.ReactNode> = {
  info: <Info className="h-6 w-6 text-sky-600" aria-hidden="true" />,
  success: <CheckCircle2 className="h-6 w-6 text-emerald-600" aria-hidden="true" />,
  warning: <AlertTriangle className="h-6 w-6 text-amber-600" aria-hidden="true" />,
  error: <XCircle className="h-6 w-6 text-red-600" aria-hidden="true" />,
  question: <HelpCircle className="h-6 w-6 text-brand-700" aria-hidden="true" />,
};

const TONE_RING: Record<SweetAlertTone, string> = {
  info: "bg-sky-50",
  success: "bg-emerald-50",
  warning: "bg-amber-50",
  error: "bg-red-50",
  question: "bg-brand-50",
};

const TONE_VARIANT: Record<SweetAlertTone, "primary" | "destructive"> = {
  info: "primary",
  success: "primary",
  warning: "primary",
  error: "destructive",
  question: "primary",
};

/**
 * The app's alert dialogs, in one place.
 *
 * Every desk needs the same two things: a "that worked" popup after a save that
 * changed shared records, and a "are you sure?" popup before a change that
 * cannot be undone. Both are rendered by this provider, which sits at the root
 * of the app next to `ToastProvider`, so any client component can reach them
 * with `useSweetAlert()` instead of re-implementing a modal.
 */
export function SweetAlertProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<PendingRequest | null>(null);

  const alert = useCallback(
    (options: SweetAlertOptions) =>
      new Promise<void>((resolve) => {
        setRequest({ ...options, kind: "alert", resolve: () => resolve() });
      }),
    []
  );

  const confirm = useCallback(
    (options: SweetAlertOptions) =>
      new Promise<boolean>((resolve) => {
        setRequest({ ...options, kind: "confirm", resolve });
      }),
    []
  );

  const value = useMemo<SweetAlertContextValue>(
    () => ({ alert, confirm }),
    [alert, confirm]
  );

  function settle(accepted: boolean) {
    const current = request;
    if (!current) return;
    // Clear first: the resolver may trigger another alert in the same tick, and
    // the dialog must not show the old request while the new one is queued.
    setRequest(null);
    current.resolve(accepted);
  }

  const tone = request?.tone ?? "info";

  return (
    <SweetAlertContext.Provider value={value}>
      {children}
      <Modal
        open={Boolean(request)}
        onClose={() => settle(false)}
        title={request?.title ?? ""}
        size="sm"
        closeLabel={request?.cancelLabel ?? "Close"}
      >
        {request ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <span
                className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${TONE_RING[tone]}`}
              >
                {TONE_ICON[tone]}
              </span>
              <p className="pt-1.5 text-sm leading-relaxed text-ink-muted">
                {request.text}
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {request.kind === "confirm" && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => settle(false)}
                >
                  {request.cancelLabel ?? "Cancel"}
                </Button>
              )}
              <Button
                type="button"
                variant={TONE_VARIANT[tone]}
                onClick={() => settle(true)}
              >
                {request.confirmLabel ?? (request.kind === "confirm" ? "Confirm" : "OK")}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </SweetAlertContext.Provider>
  );
}

export function useSweetAlert(): SweetAlertContextValue {
  const ctx = useContext(SweetAlertContext);
  if (!ctx) {
    throw new Error("useSweetAlert must be used within a SweetAlertProvider");
  }
  return ctx;
}
