"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api-client";
import { getNativePlatform, readNativeToken } from "@/lib/capacitor-types";
import {
  clearNativeCrashReport,
  isNativeShell,
  readAlertBridgeState,
  readLastExitReport,
  readNativeCrashReport,
  readPushDiagnostics,
  staleBridgeExplanation,
  waitForAlertBridge,
  type AlertBridgeState,
  type NativeExitReport,
  type NativePushDiagnostics,
} from "@/lib/native-diagnostics";

type ServerState = {
  registered: boolean;
  serverConfigured?: boolean;
};

function maskToken(token: string | null): string {
  if (!token) return "—";
  if (token.length <= 10) return `…${token}`;
  return `${token.slice(0, 4)}…${token.slice(-6)}`;
}

/**
 * "Alert diagnostics" — everything needed to understand why this phone does or
 * does not receive push alerts, in one place, with a copy button.
 *
 * The red "Push failed" banner a phone user sees is only a summary; this card
 * adds the native push state, the last registration error and the last fatal
 * problem the shell recorded, plus whether the *server* can send at all (the two
 * halves fail independently and are fixed in different places).
 */
export function NativeDiagnosticsCard() {
  const [native, setNative] = useState(false);
  // Read lazily: on a current APK the bridge is already attached by the time the
  // page runs, so the first paint is correct; refresh() re-reads it after the
  // wait in case it lands later.
  const [bridgeState, setBridgeState] = useState<AlertBridgeState>(() => readAlertBridgeState());
  const [diagnostics, setDiagnostics] = useState<NativePushDiagnostics | null>(null);
  const [crash, setCrash] = useState<string | null>(null);
  const [exit, setExit] = useState<NativeExitReport | null>(null);
  const [server, setServer] = useState<ServerState | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      await waitForAlertBridge(2000);
      setBridgeState(readAlertBridgeState());
      setDiagnostics(readPushDiagnostics());
      setCrash(readNativeCrashReport());
      setExit(readLastExitReport());

      if (isNativeShell()) {
        const result = await apiRequest<ServerState>(
          `/api/v1/alerts/push/token?platform=${getNativePlatform()}`
        );
        if (result.success) {
          setServer(result.data);
          setServerError(null);
        } else {
          setServer(null);
          setServerError(result.error.message);
        }
      }
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const nativeShell = isNativeShell();
    setNative(nativeShell);
    if (nativeShell) void refresh();
  }, [refresh]);

  if (!native) return null;

  // When the APK predates the bridge, the native rows are not "unknown" — they
  // are unreadable, and the card says which it is so the fix is obvious.
  const unreadable = bridgeState === "current" ? "unknown" : "not reported (old APK)";

  /** Value for a native-only row: the real answer, "old APK", or "unknown". */
  const nativeRow = (read: (d: NativePushDiagnostics) => string): string => {
    if (diagnostics) return read(diagnostics);
    return bridgeState === "current" ? "unknown" : "old APK";
  };

  // The native layer keeps its last token in SharedPreferences, which only a
  // current APK can report. The web layer remembers the same token in
  // localStorage when it registers it, so an older APK can still show the token
  // this phone last registered with (that is also what "Registered on the
  // server: yes" refers to).
  const rememberedToken = readNativeToken();
  const tokenDisplay = diagnostics?.lastToken
    ? maskToken(diagnostics.lastToken)
    : rememberedToken
      ? `${maskToken(rememberedToken)} (remembered by the app)`
      : diagnostics
        ? "—" // readable diagnostics with no token: definitively none
        : bridgeState === "current"
          ? "unknown"
          : "none";

  const report = [
    "BarangayResolve native push diagnostics",
    `Generated: ${new Date().toISOString()}`,
    `Platform: ${getNativePlatform()}`,
    `Native bridge: ${bridgeState}`,
    `Push available: ${diagnostics ? diagnostics.available : unreadable}`,
    `Reason: ${diagnostics?.reason ?? "—"}`,
    `google-services.json packaged: ${diagnostics ? diagnostics.configPresent : unreadable}`,
    `Firebase initialized: ${diagnostics ? diagnostics.firebaseInitialized : unreadable}`,
    `Last registration error: ${diagnostics?.lastError ?? unreadable}`,
    `Last error at: ${diagnostics?.lastErrorAt ?? "—"}`,
    `Token: ${diagnostics?.lastToken ?? rememberedToken ?? (diagnostics ? "none" : unreadable)}`,
    `Server registered: ${server ? server.registered : serverError ? `error: ${serverError}` : "unknown"}`,
    `Server has FCM credentials: ${server?.serverConfigured ?? "unknown"}`,
    crash ? `Last crash:\n${crash}` : "Last crash: none",
    exit
      ? `Last exit reported by Android: ${exit.label} (${exit.at})${exit.description ? `\n${exit.description}` : ""}`
      : "Last exit reported by Android: unavailable",
  ].join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  const healthy =
    bridgeState === "current" &&
    diagnostics?.available === true &&
    server?.serverConfigured !== false;

  const staleExplanation = staleBridgeExplanation(bridgeState);

  return (
    <Card
      title="Alert diagnostics"
      description="What this phone and the server report about push alerts."
      className="mt-4"
    >
      <div className="space-y-3 text-sm">
        <p
          className={`rounded-lg border px-3 py-2 font-semibold ${
            healthy
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
          role="status"
        >
          {staleExplanation
            ? staleExplanation
            : diagnostics?.available === false
              ? `This build cannot register for push: ${diagnostics.reason}`
              : server?.serverConfigured === false
                ? "This phone is registered, but the server has no Firebase service-account credentials, so alerts cannot be delivered."
                : diagnostics?.available
                  ? "This build can register for push alerts."
                  : "Push state could not be read yet. Press “Refresh”."}
        </p>

        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              google-services.json packaged
            </dt>
            <dd className="text-slate-800">{nativeRow((d) => (d.configPresent ? "yes" : "no"))}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Firebase started
            </dt>
            <dd className="text-slate-800">
              {nativeRow((d) => (d.firebaseInitialized ? "yes" : "no"))}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Device token
            </dt>
            <dd className="text-slate-800">{tokenDisplay}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Registered on the server
            </dt>
            <dd className="text-slate-800">
              {server ? (server.registered ? "yes" : "no") : serverError ?? "unknown"}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Last push error
            </dt>
            <dd className="text-slate-800">
              {diagnostics
                ? (diagnostics.lastError ?? "none")
                : bridgeState === "current"
                  ? "unknown"
                  : "old APK"}
              {diagnostics?.lastErrorAt ? (
                <span className="ml-1 text-xs text-slate-500">({diagnostics.lastErrorAt})</span>
              ) : null}
            </dd>
          </div>
        </dl>

        {exit ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Why the last run ended (Android)
            </p>
            <p className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-700">
              {exit.label}
              {exit.at ? <span className="ml-1 text-slate-500">({exit.at})</span> : null}
              {exit.description ? <span className="mt-1 block">{exit.description}</span> : null}
            </p>
          </div>
        ) : null}

        {crash ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Last problem the app recorded
            </p>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-700">
              {crash}
            </pre>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => {
                clearNativeCrashReport();
                setCrash(null);
              }}
            >
              Clear it
            </Button>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={copy}>
            <Copy size={14} aria-hidden="true" />
            {copied ? "Copied" : "Copy diagnostics"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={busy}>
            <RefreshCw size={14} aria-hidden="true" />
            {busy ? "Checking…" : "Refresh"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
