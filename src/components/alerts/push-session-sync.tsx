"use client";

import { useEffect } from "react";
import { apiRequest } from "@/lib/api-client";
import { setNativeSessionActive, syncWebPushRegistration } from "@/lib/push-device";

/**
 * Keeps the device's alert registration aligned with the session the browser
 * actually holds.
 *
 * Two jobs:
 *
 * 1. Mirror the session into the native Android layer. An alert that is already
 *    in flight, or one saved by `AlertRestartReceiver`, can otherwise start the
 *    alarm foreground service long after the user signed out.
 * 2. Re-bind an existing browser push subscription to the account that just
 *    signed in, so push resumes without the user revisiting /alerts.
 *
 * `signedIn` comes from the server render, so it is authoritative even when the
 * device is offline — which is exactly when a stale alarm would otherwise still
 * go off. The `/api/v1/auth/me` round trip is only used to re-check after an
 * in-page sign-in, and a network failure there leaves the current state alone
 * rather than falsely reporting "signed out".
 */
export function PushSessionSync({ signedIn }: { signedIn: boolean }) {
  useEffect(() => {
    let cancelled = false;

    const apply = (isSignedIn: boolean) => {
      setNativeSessionActive(isSignedIn);
      if (isSignedIn) void syncWebPushRegistration();
    };

    async function refresh() {
      const me = await apiRequest<{ user: unknown }>("/api/v1/auth/me");
      if (cancelled) return;
      // Offline / server unreachable: never change the native alarm state on the
      // strength of a request that never reached the server.
      if (!me.success && me.error.code === "NETWORK_ERROR") return;
      apply(me.success);
    }

    apply(signedIn);

    // Dispatched by the sign-in and registration forms, which are client-side
    // navigations and therefore never re-render this layout.
    const onAuthReady = () => void refresh();
    window.addEventListener("native-auth-ready", onAuthReady);
    return () => {
      cancelled = true;
      window.removeEventListener("native-auth-ready", onAuthReady);
    };
  }, [signedIn]);

  return null;
}
