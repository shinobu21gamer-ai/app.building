"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { copy, type Locale } from "@/lib/i18n";
import { PolicyForm, type PolicyFormValues } from "@/components/sla/policy-form";

/**
 * Row actions for one policy: open it for editing, or retire it by deactivating
 * it. Deactivating never deletes: the escalations it already produced have to
 * stay explainable.
 */
export function PolicyActions({
  locale,
  policy,
  types,
}: {
  locale: Locale;
  policy: PolicyFormValues & { id: number };
  types: Array<{ id: number; name: string }>;
}) {
  const t = copy[locale].revamp.slaDesk;
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    const response = await apiRequest(`/api/v1/admin/sla/policies/${policy.id}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: !policy.isActive }),
    });
    setBusy(false);
    if (!response.success) {
      setError(response.error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setEditing((value) => !value)}>
          {editing ? copy[locale].revamp.common.cancel : t.editPolicy}
        </Button>
        <Button
          size="sm"
          variant={policy.isActive ? "ghost" : "secondary"}
          loading={busy}
          onClick={toggle}
        >
          {policy.isActive ? t.deactivate : t.activate}
        </Button>
      </div>

      {error ? <FormMessage tone="error">{error}</FormMessage> : null}

      {editing ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <PolicyForm
            locale={locale}
            types={types}
            policy={policy}
            onDone={() => setEditing(false)}
          />
        </div>
      ) : null}
    </div>
  );
}
