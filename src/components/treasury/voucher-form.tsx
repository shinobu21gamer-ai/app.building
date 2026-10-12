"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  FormMessage,
  Input,
  Label,
  RequiredLegend,
  Textarea,
} from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { formatPeso } from "@/lib/cases/manpower";
import { copy, type Locale } from "@/lib/i18n";
import {
  MODES_OF_PAYMENT,
  PAYEE_TYPE_LABELS,
  PAYEE_TYPES,
} from "@/lib/validations/treasury";

const selectStyles =
  "h-10 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

export type VoucherAllocationOption = {
  id: number;
  label: string;
  coaCode: string;
  available: number;
};

export type VoucherEarmarkOption = {
  id: number;
  code: string | null;
  purpose: string;
  amount: number;
  committed: number;
};

/**
 * Prepares a draft voucher. Picking an approved earmark draws on money that is
 * already set aside; otherwise the voucher has to fit in the allocation's live
 * available balance — the API refuses anything else.
 */
export function VoucherForm({
  allocations,
  earmarks = [],
  caseOptions = [],
  presetAllocationId = null,
  presetEarmarkId = null,
  presetConcernId = null,
  presetPayee = "",
  presetParticulars = "",
  presetAmount = null,
  locale = "en",
}: {
  allocations: VoucherAllocationOption[];
  earmarks?: VoucherEarmarkOption[];
  caseOptions?: Array<{ id: number; caseNumber: string; title: string }>;
  presetAllocationId?: number | null;
  presetEarmarkId?: number | null;
  presetConcernId?: number | null;
  presetPayee?: string;
  presetParticulars?: string;
  presetAmount?: number | null;
  locale?: Locale;
}) {
  const t = copy[locale].revamp.treasuryDesk;
  const common = copy[locale].revamp.common;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allocationId, setAllocationId] = useState<number | null>(
    presetAllocationId ?? allocations[0]?.id ?? null
  );

  const openEarmarks = earmarks.filter(
    (earmark) => earmark.amount > earmark.committed
  );

  if (allocations.length === 0) {
    return <p className="text-sm text-ink-subtle">{t.noEntries}</p>;
  }

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        {t.newVoucher}
      </Button>
    );
  }

  async function submit(formData: FormData) {
    setBusy(true);
    setError(null);

    const earmarkId = String(formData.get("earmarkId") ?? "");
    const concernId = String(formData.get("concernId") ?? "");
    const modeOfPayment = String(formData.get("modeOfPayment") ?? "");

    const result = await apiRequest<{ voucherNumber: string }>(
      "/api/v1/treasury/disbursements",
      {
        method: "POST",
        body: JSON.stringify({
          allocationId: Number(formData.get("allocationId")),
          earmarkId: earmarkId === "" ? null : Number(earmarkId),
          concernId: concernId === "" ? null : Number(concernId),
          payee: String(formData.get("payee") ?? ""),
          payeeType: String(formData.get("payeeType") ?? "SUPPLIER"),
          amount: Number(formData.get("amount")),
          particulars: String(formData.get("particulars") ?? ""),
          modeOfPayment: modeOfPayment === "" ? undefined : modeOfPayment,
        }),
      }
    );

    setBusy(false);
    if (!result.success) {
      setError(result.error.message);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <form action={submit} className="space-y-4">
      <RequiredLegend>{t.requiredLegend}</RequiredLegend>
      {error && <FormMessage tone="error">{error}</FormMessage>}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="voucher-payee" required>
            {t.payee}
          </Label>
          <Input
            id="voucher-payee"
            name="payee"
            required
            maxLength={160}
            defaultValue={presetPayee}
            placeholder="Sunrise Hardware"
          />
        </div>
        <div>
          <Label htmlFor="voucher-payee-type" required>
            {t.payeeType}
          </Label>
          <select
            id="voucher-payee-type"
            name="payeeType"
            required
            defaultValue="SUPPLIER"
            className={selectStyles}
          >
            {PAYEE_TYPES.map((type) => (
              <option key={type} value={type}>
                {PAYEE_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="voucher-amount" required>
            {t.amountLabel}
          </Label>
          <Input
            id="voucher-amount"
            name="amount"
            type="number"
            min="0.01"
            step="0.01"
            required
            defaultValue={presetAmount ?? undefined}
          />
        </div>
        <div>
          <Label htmlFor="voucher-mode">{t.modeOfPayment}</Label>
          <select
            id="voucher-mode"
            name="modeOfPayment"
            defaultValue=""
            className={selectStyles}
          >
            <option value="">—</option>
            {MODES_OF_PAYMENT.map((mode) => (
              <option key={mode} value={mode}>
                {mode.replace("_", " ").toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="voucher-allocation" required>
            {t.coaAccount}
          </Label>
          <select
            id="voucher-allocation"
            name="allocationId"
            required
            value={allocationId ?? undefined}
            onChange={(event) => setAllocationId(Number(event.target.value))}
            className={selectStyles}
          >
            {allocations.map((allocation) => (
              <option key={allocation.id} value={allocation.id}>
                {allocation.coaCode} · {allocation.label} ·{" "}
                {formatPeso(allocation.available)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="voucher-earmark">{t.earmarksTitle}</Label>
          <select
            id="voucher-earmark"
            name="earmarkId"
            defaultValue={presetEarmarkId ?? ""}
            className={selectStyles}
          >
            <option value="">{t.available} · {t.coaAccount}</option>
            {openEarmarks.map((earmark) => (
              <option key={earmark.id} value={earmark.id}>
                {earmark.code ?? `#${earmark.id}`} · {earmark.purpose} ·{" "}
                {formatPeso(earmark.amount - earmark.committed)} left
              </option>
            ))}
          </select>
        </div>
        {caseOptions.length > 0 && (
          <div className="sm:col-span-2">
            <Label htmlFor="voucher-case">{t.linkedCase}</Label>
            <select
              id="voucher-case"
              name="concernId"
              defaultValue={presetConcernId ?? ""}
              className={selectStyles}
            >
              <option value="">—</option>
              {caseOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.caseNumber} — {option.title}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div>
        <Label htmlFor="voucher-particulars" required>
          {t.particulars}
        </Label>
        <Textarea
          id="voucher-particulars"
          name="particulars"
          rows={2}
          minLength={5}
          maxLength={300}
          required
          defaultValue={presetParticulars}
          placeholder="Cement, sand and steel bars for the comfort room repair"
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? common.saving : t.prepareVoucher}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen(false)}
          disabled={busy}
        >
          {common.cancel}
        </Button>
      </div>
    </form>
  );
}
