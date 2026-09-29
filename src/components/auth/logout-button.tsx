"use client";

import { useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

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
    const result = await apiRequest("/api/v1/auth/logout", { method: "POST" });
    if (result.success) {
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
      {submitting ? "Signing out…" : "Sign out"}
    </Button>
  );
}