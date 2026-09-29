"use client";

import { getPushMode } from "@/lib/capacitor-types";
import { ServerUrlSettings } from "@/components/settings/server-url-settings";

/**
 * The server address is only configurable on device. On the web the origin is
 * already correct, so nothing is shown.
 */
export function NativeServerUrlCard() {
  if (getPushMode() !== "capacitor") return null;

  return <ServerUrlSettings onSaved={() => window.location.reload()} />;
}
