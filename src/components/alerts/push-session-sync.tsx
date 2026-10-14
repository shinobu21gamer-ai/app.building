"use client";

import { useEffect } from "react";
import { apiRequest } from "@/lib/api-client";
import { setNativeSessionActive, syncWebPushRegistration } from "@/lib/push-device";
import { isNativeShell, waitForAlertBridge } from "@/lib/native-diagnostics";

/** Mirror the authoritative session after the Android bridge is actually ready.
 * A stale layout result must not overwrite a newer in-page sign-in. */
export function PushSessionSync({ signedIn }: { signedIn: boolean }) {
  useEffect(() => {
    let cancelled = false;
    let revision = 0;

    const apply = async (isSignedIn: boolean) => {
      const current = ++revision;
      if (isNativeShell()) await waitForAlertBridge(5000);
      if (cancelled || current !== revision) return;
      setNativeSessionActive(isSignedIn);
      if (isSignedIn) void syncWebPushRegistration();
    };

    async function refresh() {
      const current = ++revision;
      const me = await apiRequest<{ user: unknown }>("/api/v1/auth/me");
      if (cancelled || current !== revision) return;
      // A server error or lost connection says nothing about session validity.
      if (!me.success && me.error.code !== "UNAUTHORIZED") return;
      await apply(me.success);
    }

    void apply(signedIn);
    const onAuthReady = () => void refresh();
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("native-auth-ready", onAuthReady);
    window.addEventListener("online", onAuthReady);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      ++revision;
      window.removeEventListener("native-auth-ready", onAuthReady);
      window.removeEventListener("online", onAuthReady);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [signedIn]);
  return null;
}
