"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";

const STORAGE_KEY = "barangayresolve.serverUrl";
const DEFAULT_URL = "http://localhost:3000";

function normalize(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}

export function isValidServerUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

export function readServerUrl(): string {
  if (typeof window === "undefined") return DEFAULT_URL;
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_URL;
  } catch {
    return DEFAULT_URL;
  }
}

export function writeServerUrl(url: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, normalize(url));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Shown only inside the native shell. The tunnel URL changes whenever the
 * quick tunnel restarts, so the app must not depend on a baked-in host.
 */
export function ServerUrlSettings({ onSaved }: { onSaved?: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue(readServerUrl());
  }, []);

  function apply(event: React.FormEvent) {
    event.preventDefault();
    const next = normalize(value);
    if (!isValidServerUrl(next)) {
      setError("Enter a full address, for example https://example.trycloudflare.com");
      return;
    }
    setError(null);
    writeServerUrl(next);
    onSaved?.();
  }

  return (
    <form
      onSubmit={apply}
      className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4"
    >
      <div>
        <h2 className="font-semibold text-slate-900">App server address</h2>
        <p className="mt-1 text-xs text-slate-600">
          The public tunnel address changes each time it restarts. Update it here
          instead of rebuilding the app.
        </p>
      </div>
      <div>
        <Label htmlFor="server-url">Server URL</Label>
        <Input
          id="server-url"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="https://your-tunnel.trycloudflare.com"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
        />
        {error && <p className="mt-1 text-xs font-medium text-red-600">{error}</p>}
      </div>
      <Button type="submit">Save and connect</Button>
    </form>
  );
}
