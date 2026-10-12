"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError, FormMessage, Input, Label, Textarea } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { copy, type Locale } from "@/lib/i18n";
import { DSR_STATUSES, type DsrStatus } from "@/lib/privacy/catalog";

type DsrRow = {
  id: number;
  referenceCode: string;
  type: string;
  typeLabel: string;
  status: string;
  statusLabel: string;
  requestedAt: string;
  dueAt: string | null;
  resolvedAt: string | null;
  details: string | null;
  resolutionNotes: string | null;
  denialReason: string | null;
  overdue: boolean;
  resident: {
    id: number;
    name: string;
    email: string;
    phoneMasked: string | null;
  };
};

const selectStyles =
  "h-10 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

/**
 * Data subject request queue with the actions that close a request.
 *
 * Completing an ERASURE request anonymises the resident on the server in the
 * same transaction, so the note the administrator writes here is the record of
 * why the data was removed.
 */
export function DsrQueue({
  requests,
  locale = "en",
}: {
  requests: readonly DsrRow[];
  locale?: Locale;
}) {
  const t = copy[locale].revamp.adminDesk;
  const common = copy[locale].revamp.common;
  const router = useRouter();
  const { showToast } = useToast();
  const [openId, setOpenId] = useState<number | null>(null);
  const [status, setStatus] = useState<DsrStatus>("IN_REVIEW");
  const [notes, setNotes] = useState("");
  const [denial, setDenial] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(id: number) {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const result = await apiRequest(`/api/v1/admin/privacy/requests/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status,
        resolutionNotes: notes.trim() === "" ? undefined : notes.trim(),
        denialReason: denial.trim() === "" ? undefined : denial.trim(),
      }),
    });
    setBusy(false);
    if (!result.success) {
      setError(result.error.message);
      return;
    }
    setOpenId(null);
    setNotes("");
    setDenial("");
    showToast("success", common.saved);
    router.refresh();
  }

  if (requests.length === 0) {
    return <p className="text-sm text-ink-subtle">{t.dsrNone}</p>;
  }

  return (
    <div className="space-y-3">
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <ul className="space-y-3">
        {requests.map((request) => (
          <li
            key={request.id}
            className="rounded-control border border-line px-4 py-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-ink">
                  {request.referenceCode} · {request.typeLabel}
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {request.resident.name} · {request.resident.email}
                  {request.resident.phoneMasked
                    ? ` · ${request.resident.phoneMasked}`
                    : ""}
                </p>
                <p className="mt-0.5 text-xs text-ink-subtle">
                  {common.date}: {request.requestedAt.slice(0, 10)}
                  {request.dueAt ? ` · ${request.dueAt.slice(0, 10)}` : ""}
                </p>
                {request.details && (
                  <p className="mt-1 text-xs text-ink-muted">{request.details}</p>
                )}
                {request.resolutionNotes && (
                  <p className="mt-1 text-xs text-ink-muted">
                    {t.resolutionNotes}: {request.resolutionNotes}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {request.overdue && <Badge tone="red">{t.overdue}</Badge>}
                <Badge
                  tone={
                    request.status === "COMPLETED"
                      ? "green"
                      : request.status === "REJECTED"
                        ? "gray"
                        : "amber"
                  }
                >
                  {request.statusLabel}
                </Badge>
                {request.status !== "COMPLETED" && request.status !== "REJECTED" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setOpenId(request.id);
                      setStatus("IN_REVIEW");
                      setNotes(request.resolutionNotes ?? "");
                      setDenial(request.denialReason ?? "");
                    }}
                  >
                    {t.handle}
                  </Button>
                )}
              </div>
            </div>

            {openId === request.id && (
              <div className="mt-3 space-y-3 border-t border-line pt-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor={`status-${request.id}`}>{common.status}</Label>
                    <select
                      id={`status-${request.id}`}
                      value={status}
                      onChange={(event) => setStatus(event.target.value as DsrStatus)}
                      className={selectStyles}
                    >
                      {DSR_STATUSES.filter((value) => value !== "RECEIVED").map(
                        (value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        )
                      )}
                    </select>
                  </div>
                  {status === "REJECTED" && (
                    <div>
                      <Label htmlFor={`denial-${request.id}`}>
                        {t.denialReason}
                      </Label>
                      <Input
                        id={`denial-${request.id}`}
                        value={denial}
                        maxLength={500}
                        onChange={(event) => setDenial(event.target.value)}
                      />
                    </div>
                  )}
                </div>
                <div>
                  <Label htmlFor={`notes-${request.id}`}>
                    {t.resolutionNotes}{" "}
                    {status === "COMPLETED" && <span aria-hidden="true">*</span>}
                  </Label>
                  <Textarea
                    id={`notes-${request.id}`}
                    value={notes}
                    rows={3}
                    maxLength={2000}
                    onChange={(event) => setNotes(event.target.value)}
                  />
                  {fieldErrors.notes && <FieldError>{fieldErrors.notes}</FieldError>}
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    loading={busy}
                    disabled={busy}
                    onClick={() => submit(request.id)}
                  >
                    {common.save}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setOpenId(null)}
                  >
                    {common.cancel}
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Unmasking one resident's phone number. The reason is mandatory and lands in
 * PiiAccessLog, which the resident may ask to see.
 */
export function PiiRevealForm({ locale = "en" }: { locale?: Locale }) {
  const t = copy[locale].revamp.adminDesk;
  const [subjectUserId, setSubjectUserId] = useState("");
  const [reason, setReason] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setPhone(null);
    const result = await apiRequest<{ phone: string | null }>(
      "/api/v1/admin/privacy/reveal",
      {
        method: "POST",
        body: JSON.stringify({
          subjectUserId: Number(subjectUserId),
          reason: reason.trim(),
        }),
      }
    );
    setBusy(false);
    if (!result.success) {
      setError(result.error.message);
      return;
    }
    setPhone(result.data.phone);
    setReason("");
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <FormMessage tone="error">{error}</FormMessage>}
      {phone && (
        <FormMessage tone="success">
          {t.revealed}: {phone}
        </FormMessage>
      )}
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <div>
          <Label htmlFor="reveal-user">
            ID
          </Label>
          <Input
            id="reveal-user"
            value={subjectUserId}
            inputMode="numeric"
            aria-required="true"
            onChange={(event) => setSubjectUserId(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="reveal-reason">
            {t.revealReason}
          </Label>
          <Input
            id="reveal-reason"
            value={reason}
            maxLength={300}
            aria-required="true"
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      </div>
      <p className="text-xs text-ink-subtle">{t.revealHelp}</p>
      <Button
        type="submit"
        size="sm"
        loading={busy}
        disabled={busy || subjectUserId.trim() === "" || reason.trim().length < 5}
      >
        {t.reveal}
      </Button>
    </form>
  );
}

/** Admin switch for the resident identity-verification requirement. */
export function VerificationGateToggle({
  enabled,
  locale = "en",
}: {
  enabled: boolean;
  locale?: Locale;
}) {
  const t = copy[locale].revamp.adminDesk;
  const router = useRouter();
  const { showToast } = useToast();
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !on;
    setBusy(true);
    setError(null);
    const result = await apiRequest("/api/v1/admin/settings", {
      method: "PUT",
      body: JSON.stringify({
        key: "resident.identity_verification_required",
        value: next ? "true" : "false",
      }),
    });
    setBusy(false);
    if (!result.success) {
      setError(result.error.message);
      return;
    }
    setOn(next);
    showToast("success", copy[locale].revamp.common.saved);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <p className="text-xs leading-relaxed text-ink-muted">{t.gateLead}</p>
      <label className="flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={on}
          disabled={busy}
          onChange={toggle}
          className="mt-0.5 h-4 w-4 rounded border-line-strong"
        />
        <span>{on ? t.gateOn : t.gateOff}</span>
      </label>
    </div>
  );
}
