"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { copy, type Locale } from "@/lib/i18n";
import type { ConsentPurpose, ConsentStatus } from "@/lib/privacy/catalog";

type ConsentRow = {
  purpose: ConsentPurpose;
  status: ConsentStatus;
  policyVersion: string;
  grantedAt: string;
  withdrawnAt: string | null;
};

type CatalogRow = {
  purpose: ConsentPurpose;
  label: string;
  description: string;
  requiredAtSignup: boolean;
  withdrawable: boolean;
};

/**
 * Consent history and controls.
 *
 * Consent is append-only on the server: granting writes a new row, withdrawing
 * stamps the current one, and the history stays provable. Purposes the account
 * cannot survive without are shown but cannot be withdrawn here — the resident
 * is pointed at a data erasure request instead.
 */
export function ConsentPanel({
  consents,
  catalog,
  policyVersion,
  locale = "en",
}: {
  consents: readonly ConsentRow[];
  catalog: readonly CatalogRow[];
  policyVersion: string;
  locale?: Locale;
}) {
  const t = copy[locale].revamp.privacyCenter;
  const router = useRouter();
  const { showToast } = useToast();
  const [busyPurpose, setBusyPurpose] = useState<ConsentPurpose | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stateFor = (purpose: ConsentPurpose) =>
    consents.find((row) => row.purpose === purpose) ?? null;

  async function grant(purpose: ConsentPurpose) {
    setBusyPurpose(purpose);
    setError(null);
    const result = await apiRequest(`/api/v1/privacy/consents`, {
      method: "POST",
      body: JSON.stringify({ purpose }),
    });
    setBusyPurpose(null);
    if (!result.success) {
      setError(result.error.message);
      return;
    }
    showToast("success", t.granted);
    router.refresh();
  }

  async function withdraw(purpose: ConsentPurpose) {
    setBusyPurpose(purpose);
    setError(null);
    const result = await apiRequest(
      `/api/v1/privacy/consents?purpose=${encodeURIComponent(purpose)}`,
      { method: "DELETE" }
    );
    setBusyPurpose(null);
    if (!result.success) {
      setError(
        result.error.code === "CONFLICT" ? t.withdrawBlocked : result.error.message
      );
      return;
    }
    showToast("success", t.withdrawn);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {error && <FormMessage tone="error">{error}</FormMessage>}

      <ul className="space-y-3">
        {catalog.map((item) => {
          const state = stateFor(item.purpose);
          const granted = state?.status === "GRANTED";
          const busy = busyPurpose === item.purpose;

          return (
            <li
              key={item.purpose}
              className="rounded-lg border border-slate-200 px-4 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="max-w-xl">
                  <p className="text-sm font-medium text-slate-900">
                    {item.label}
                    {item.requiredAtSignup && (
                      <span className="ml-2 align-middle text-xs font-normal text-slate-500">
                        *
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
                    {item.description}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {t.policyVersion}: {state?.policyVersion ?? policyVersion}
                    {state?.withdrawnAt
                      ? ` · ${t.withdrawn}: ${state.withdrawnAt.slice(0, 10)}`
                      : ""}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Badge tone={granted ? "green" : "gray"}>
                    {!state ? "—" : granted ? t.granted : t.withdrawn}
                  </Badge>
                  {granted ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy || !item.withdrawable}
                      onClick={() => withdraw(item.purpose)}
                    >
                      {t.withdraw}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      loading={busy}
                      disabled={busy}
                      onClick={() => grant(item.purpose)}
                    >
                      {t.grant}
                    </Button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
