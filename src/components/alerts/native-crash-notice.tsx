"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Copy, X } from "lucide-react";
import {
  type NativeExitReport,
  clearNativeCrashReport,
  isNativeShell,
  readLastExitReport,
  readNativeCrashReport,
} from "@/lib/native-diagnostics";

const DISMISSED_KEY = "barangayresolve.nativeExitNotice";

/**
 * Explains why the app closed last time.
 *
 * Two sources, because they catch different failures: {@link readNativeCrashReport}
 * (our uncaught-exception handler and the WebView-renderer recovery) and
 * {@link readLastExitReport} (Android's own record — a native crash, an ANR or a
 * low-memory kill never reaches our handler but does appear there). Mounted once
 * in the root layout; renders nothing on the web or when the last run was
 * normal.
 */
export function NativeCrashNotice() {
  const [crash, setCrash] = useState<string | null>(null);
  const [exit, setExit] = useState<NativeExitReport | null>(null);
  const [copied, setCopied] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isNativeShell()) return;

    let attempts = 0;
    const read = () => {
      const crashReport = readNativeCrashReport();
      const exitReport = readLastExitReport();
      const abnormal = exitReport?.abnormal === true;

      if (!crashReport && !abnormal) return false;

      if (abnormal && exitReport) {
        // The same Android-reported exit must not nag on every launch; a new one
        // (different timestamp) is shown again.
        try {
          if (window.localStorage.getItem(DISMISSED_KEY) === exitReport.at) {
            setCrash(crashReport);
            return true;
          }
        } catch {
          // Storage unavailable: show it.
        }
      }

      setCrash(crashReport);
      setExit(exitReport);
      return true;
    };

    if (read()) return;
    // The bridge object is injected when the activity resumes, which can land a
    // moment after this page starts running.
    const timer = window.setInterval(() => {
      attempts += 1;
      if (read() || attempts > 30) window.clearInterval(timer);
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  const hasSomething = Boolean(crash) || Boolean(exit?.abnormal);
  if (!hasSomething || dismissed) return null;

  const dismiss = () => {
    clearNativeCrashReport();
    if (exit) {
      try {
        window.localStorage.setItem(DISMISSED_KEY, exit.at);
      } catch {
        // Storage unavailable: it will show again, which is acceptable.
      }
    }
    setDismissed(true);
  };

  const detail = [exit?.abnormal ? `${exit.label}` : null, crash ? `\n\n${crash}` : null]
    .filter(Boolean)
    .join("");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(detail.trim());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard blocked: the text stays selectable on screen.
    }
  };

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-3" role="alert">
      <div className="mx-auto flex max-w-5xl items-start gap-3">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900">
            The app closed last time. Here is what Android recorded:
          </p>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-amber-200 bg-white p-3 text-xs leading-5 text-slate-700">
            {detail.trim()}
          </pre>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
            >
              <Copy size={13} aria-hidden="true" />
              {copied ? "Copied" : "Copy report"}
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
            >
              <X size={13} aria-hidden="true" />
              Dismiss
            </button>
          </div>
          <p className="mt-2 text-xs text-amber-800">
            The same details are always available under Alerts → Alert diagnostics.
          </p>
        </div>
      </div>
    </div>
  );
}
