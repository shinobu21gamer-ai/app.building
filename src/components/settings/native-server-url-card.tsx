"use client";

import { useEffect, useState } from "react";
import { getPushMode } from "@/lib/capacitor-types";
import { ServerUrlSettings } from "@/components/settings/server-url-settings";

/**
 * The server address is only configurable on device. On the web the origin is
 * already correct, so nothing is shown.
 *
 * getPushMode() is SSR-hostile ("unknown" with no window), so render nothing on
 * the first client pass to avoid a hydration mismatch in the native WebView.
 */
export function NativeServerUrlCard() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || getPushMode() !== "capacitor") return null;

  return <ServerUrlSettings onSaved={() => window.location.reload()} />;
}
