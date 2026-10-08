"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { forgetNativeToken } from "@/lib/capacitor-types";
import {
  collectPushDeviceIdentity,
  setNativeSessionActive,
} from "@/lib/push-device";

export function LogoutButton({
  variant = "outline",
  size = "md",
  className,
}: {
  variant?: "outline" | "ghost";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function handleLogout() {
    setSubmitting(true);

    // Identify this device before the session ends, so the server can drop it
    // from alert delivery without touching the user's other devices.
    const device = await collectPushDeviceIdentity();
    const result = await apiRequest("/api/v1/auth/logout", {
      method: "POST",
      body: JSON.stringify(device),
    });

    if (result.success) {
      // Tell the native alarm layer nobody is signed in any more, and drop the
      // remembered FCM token so a different account signing in on this phone
      // can claim it instead of hitting the cross-account token guard.
      setNativeSessionActive(false);
      forgetNativeToken();
      window.location.replace("/login");
      return;
    }
    setSubmitting(false);
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleLogout}
      disabled={submitting}
      className={className}
    >
      <LogOut size={15} aria-hidden="true" />
      {submitting ? "Signing out…" : "Sign out"}
    </Button>
  );
}
