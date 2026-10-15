"use client";

import { useMemo, useState } from "react";
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
  concernId: number | null;
  allocationId?: number;
};

export type VoucherCrewMember = {
  id: number;
  name: string;
  trade: string | null;
};

export type VoucherCrewLine = {
  userId: number;
  name: string;
  amount: number | null;
};

type PayLine = { key: string; userId: number | ""; amount: string };

function newLine(userId: number | "" = "", amount = ""): PayLine {
  return { key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, userId, amount };
}

/**
 * Prepares a draft voucher. Picking an approved earmark draws on money that is
 * already set aside; otherwise the voucher has to fit in the allocation's live
 * available balance — the API refuses anything else.
 *
 * Crew pay is one voucher per person (COA). The form lets the treasurer add
 * several crew on one screen and prepares a draft for each.
 */
export function VoucherForm({
  allocations,
  earmarks = [],
  caseOptions = [],
  crewMembers = [],
  presetAllocationId = null,
  presetEarmarkId = null,
  presetConcernId = null,
  presetPayee = "",
  presetPayeeType = "SUPPLIER",
  presetParticulars = "",
  presetAmount = null,
  presetCrewLines = [],
  defaultOpen = false,
  locale = "en",
}: {
  allocations: VoucherAllocationOption[];
  earmarks?: VoucherEarmarkOption[];
  caseOptions?: Array<{ id: number; caseNumber: string; title: string }>;
  crewMembers?: VoucherCrewMember[];
  presetAllocationId?: number | null;
  presetPayeeType?: (typeof PAYEE_TYPES)[number];
  presetEarmarkId?: number | null;
  presetConcernId?: number | null;
  presetPayee?: string;
  presetParticulars?: string;
  presetAmount?: number | null;
  /** Crew already assigned on the case, so pay-all starts from that list. */
  presetCrewLines?: VoucherCrewLine[];
  defaultOpen?: boolean;
  locale?: Locale;
}) {
  const t = copy[locale].revamp.treasuryDesk;
  const common = copy[locale].revamp.common;
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [allocationId, setAllocationId] = useState<number | null>(
    presetAllocationId ?? allocations[0]?.id ?? null
  );
  const [earmarkId, setEarmarkId] = useState<number | null>(presetEarmarkId);
  const [concernId, setConcernId] = useState<number | null>(presetConcernId);
  const [payee, setPayee] = useState(presetPayee);
  const [payeeType, setPayeeType] = useState<(typeof PAYEE_TYPES)[number]>(
    presetPayeeType
  );
  const startingCrewLines: PayLine[] =
    presetCrewLines.length > 0
      ? presetCrewLines.map((line) =>
          newLine(
            line.userId,
            line.amount !== null
              ? line.amount.toFixed(2)
              : presetAmount !== null
                ? presetAmount.toFixed(2)
                : ""
          )
        )
      : [newLine("", presetAmount !== null ? presetAmount.toFixed(2) : "")];
  const [crewLines, setCrewLines] = useState<PayLine[]>(startingCrewLines);

  const openEarmarks = earmarks.filter(
    (earmark) => earmark.amount > earmark.committed
  );
  const selectedEarmark =
    earmarkId === null
      ? null
      : (openEarmarks.find((row) => row.id === earmarkId) ?? null);
  const caseLockedToEarmark = selectedEarmark?.concernId ?? null;
  const caseRequired = payeeType === "CREW" || caseLockedToEarmark !== null;

  const crewById = useMemo(
    () => new Map(crewMembers.map((member) => [member.id, member])),
    [crewMembers]
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

  function applyEarmark(nextId: number | null) {
    setEarmarkId(nextId);
    const earmark =
      nextId === null ? null : (openEarmarks.find((row) => row.id === nextId) ?? null);
    if (earmark?.concernId) {
      setConcernId(earmark.concernId);
    }
    if (earmark?.allocationId) {
      setAllocationId(earmark.allocationId);
    }
  }

  async function submit(formData: FormData) {
    setBusy(true);
    setError(null);
    setNotice(null);

    const modeOfPayment = String(formData.get("modeOfPayment") ?? "");
    const particulars = String(formData.get("particulars") ?? "");
    const linkedCase =
      caseLockedToEarmark ??
      (concernId !== null && concernId > 0 ? concernId : null);

    if (payeeType === "CREW") {
      const rows = crewLines
        .map((line) => {
          const member =
            line.userId === "" ? null : (crewById.get(Number(line.userId)) ?? null);
          const amount = Number(line.amount);
          return { member, amount };
        })
        .filter(
          (row) => row.member !== null && Number.isFinite(row.amount) && row.amount > 0
        ) as Array<{ member: VoucherCrewMember; amount: number }>;

      if (rows.length === 0) {
        setBusy(false);
        setError(t.crewPayNeedOne);
        return;
      }
      if (linkedCase === null) {
        setBusy(false);
        setError(t.crewPayNeedCase);
        return;
      }

      let prepared = 0;
      for (const row of rows) {
        const result = await apiRequest<{ voucherNumber: string }>(
          "/api/v1/treasury/disbursements",
          {
            method: "POST",
            body: JSON.stringify({
              allocationId: Number(formData.get("allocationId")),
              earmarkId,
              concernId: linkedCase,
              payee: row.member.name,
              payeeType: "CREW",
              payeeUserId: row.member.id,
              amount: row.amount,
              particulars:
                particulars.trim() === ""
                  ? `Crew labour — ${row.member.name}`
                  : particulars,
              modeOfPayment: modeOfPayment === "" ? undefined : modeOfPayment,
            }),
          }
        );
        if (!result.success) {
          setBusy(false);
          setError(
            prepared > 0
              ? `${t.crewPayPrepared.replace("{count}", String(prepared))} ${result.error.message}`
              : result.error.message
          );
          router.refresh();
          return;
        }
        prepared += 1;
      }
      setBusy(false);
      setOpen(false);
      router.refresh();
      return;
    }

    const result = await apiRequest<{ voucherNumber: string }>(
      "/api/v1/treasury/disbursements",
      {
        method: "POST",
        body: JSON.stringify({
          allocationId: Number(formData.get("allocationId")),
          earmarkId,
          concernId: linkedCase,
          payee,
          payeeType,
          amount: Number(formData.get("amount")),
          particulars,
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
    setPayee("");
    setPayeeType("SUPPLIER");
    router.refresh();
  }

  return (
    <form action={submit} className="space-y-4">
      <RequiredLegend>{t.requiredLegend}</RequiredLegend>
      {payeeType === "CREW" && (
        <p className="rounded-control border border-brand-100 bg-brand-50 px-3 py-2 text-sm leading-relaxed text-brand-900">
          {t.crewPayLead}
        </p>
      )}
      {error && <FormMessage tone="error">{error}</FormMessage>}
      {notice && <FormMessage tone="success">{notice}</FormMessage>}

      <div className="grid gap-4 sm:grid-cols-2">
        {payeeType !== "CREW" && (
          <div>
            <Label htmlFor="voucher-payee" required>
              {t.payee}
            </Label>
            <Input
              id="voucher-payee"
              name="payee"
              required
              maxLength={160}
              value={payee}
              onChange={(event) => setPayee(event.target.value)}
              placeholder="Sunrise Hardware"
            />
          </div>
        )}
        <div>
          <Label htmlFor="voucher-payee-type" required>
            {t.payeeType}
          </Label>
          <select
            id="voucher-payee-type"
            name="payeeType"
            required
            value={payeeType}
            onChange={(event) => {
              const next = event.target.value as (typeof PAYEE_TYPES)[number];
              setPayeeType(next);
            }}
            className={selectStyles}
          >
            {PAYEE_TYPES.map((type) => (
              <option key={type} value={type}>
                {PAYEE_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>
        {payeeType !== "CREW" && (
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
        )}
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
          <Label htmlFor="voucher-earmark" required={payeeType === "CREW"}>
            {t.earmarksTitle}
          </Label>
          <select
            id="voucher-earmark"
            name="earmarkId"
            required={payeeType === "CREW"}
            value={earmarkId ?? ""}
            onChange={(event) =>
              applyEarmark(
                event.target.value === "" ? null : Number(event.target.value)
              )
            }
            className={selectStyles}
          >
            <option value="">—</option>
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
            <Label htmlFor="voucher-case" required={caseRequired}>
              {caseRequired ? t.linkedCaseRequired : t.linkedCase}
            </Label>
            <select
              id="voucher-case"
              name="concernId"
              required={caseRequired}
              value={caseLockedToEarmark ?? concernId ?? ""}
              disabled={caseLockedToEarmark !== null}
              onChange={(event) =>
                setConcernId(
                  event.target.value === "" ? null : Number(event.target.value)
                )
              }
              className={selectStyles}
            >
              <option value="">—</option>
              {caseOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.caseNumber} — {option.title}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-ink-subtle">{t.linkedCaseHint}</p>
          </div>
        )}
      </div>

      {payeeType === "CREW" && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-ink">{t.crewPayLines}</p>
          <p className="text-xs text-ink-subtle">{t.crewMemberHint}</p>
          {crewLines.map((line, index) => (
            <div key={line.key} className="grid gap-3 sm:grid-cols-[1fr_8rem_auto]">
              <select
                aria-label={t.crewMember}
                value={line.userId}
                onChange={(event) => {
                  const value =
                    event.target.value === "" ? "" : Number(event.target.value);
                  setCrewLines((rows) =>
                    rows.map((row) =>
                      row.key === line.key ? { ...row, userId: value } : row
                    )
                  );
                }}
                className={selectStyles}
              >
                <option value="">—</option>
                {crewMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                    {member.trade ? ` · ${member.trade}` : ""}
                  </option>
                ))}
              </select>
              <Input
                aria-label={t.amountLabel}
                type="number"
                min="0.01"
                step="0.01"
                value={line.amount}
                onChange={(event) =>
                  setCrewLines((rows) =>
                    rows.map((row) =>
                      row.key === line.key
                        ? { ...row, amount: event.target.value }
                        : row
                    )
                  )
                }
                placeholder="0.00"
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  setCrewLines((rows) =>
                    rows.length === 1
                      ? [newLine()]
                      : rows.filter((row) => row.key !== line.key)
                  )
                }
              >
                {t.crewPayRemove}
              </Button>
              {index === 0 && crewMembers.length === 0 ? (
                <p className="sm:col-span-3 text-xs text-ink-subtle">
                  {t.crewMemberNone}
                </p>
              ) : null}
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setCrewLines((rows) => [...rows, newLine()])}
          >
            {t.crewPayAdd}
          </Button>
        </div>
      )}

      <div>
        <Label htmlFor="voucher-particulars" required={payeeType !== "CREW"}>
          {t.particulars}
        </Label>
        <Textarea
          id="voucher-particulars"
          name="particulars"
          rows={2}
          minLength={payeeType === "CREW" ? undefined : 5}
          maxLength={300}
          required={payeeType !== "CREW"}
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
