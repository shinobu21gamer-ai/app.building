"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError, FormMessage, Label, Textarea } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { copy, type Locale } from "@/lib/i18n";
import { UploadedPhoto } from "@/components/ui/uploaded-photo";

type Submission = {
  userId: number;
  status: string;
  method: string | null;
  idTypeLabel: string | null;
  idNumberLast4: string | null;
  hasIdImage: boolean;
  idImageUrl: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  decisionReason: string | null;
  verifiedAt: string | null;
  reviewedBy: { id: number; name: string } | null;
  resident: {
    id: number;
    name: string;
    email: string;
    address: string | null;
    isActive: boolean;
    role: string | null;
    office: string | null;
  };
};

type QueueResponse = { counts: { pending: number; verified: number; rejected: number }; submissions: Submission[] };

const STATUS_TONE: Record<string, "amber" | "green" | "red" | "gray"> = {
  PENDING: "amber",
  VERIFIED: "green",
  REJECTED: "red",
};

/**
 * Identity verification queue.
 *
 * The ID number itself is never sent to the browser: only the stored last four
 * characters and the uploaded image. That file is gated by the session cookie
 * (same as case proof photos), so it is shown in-page — opening it in a new
 * tab would fail because the tab does not send that cookie.
 */
export function VerificationReview({ locale = "en" }: { locale?: Locale }) {
  const t = copy[locale].revamp.adminDesk;
  const { showToast } = useToast();
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [status, setStatus] = useState("PENDING");
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [openImageFor, setOpenImageFor] = useState<number | null>(null);

  useEffect(() => {
    if (rejectingId === null) return;
    const frame = window.requestAnimationFrame(() => {
      const field = document.getElementById(`reason-${rejectingId}`);
      if (!(field instanceof HTMLTextAreaElement)) return;
      field.focus({ preventScroll: true });
      field.scrollIntoView?.({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [rejectingId, reasonError]);

  const load = useCallback(async () => {
    const query = status === "" ? "" : `?status=${encodeURIComponent(status)}`;
    const result = await apiRequest<QueueResponse>(`/api/v1/admin/identity${query}`);
    if (!result.success) {
      setError(result.error.message);
      return;
    }
    setError(null);
    setQueue(result.data);
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(userId: number, decision: "VERIFIED" | "REJECTED", decisionReason?: string) {
    if (decision === "REJECTED" && (decisionReason ?? "").trim().length < 3) {
      setReasonError(t.rejectReasonRequired);
      const field = document.getElementById(`reason-${userId}`);
      if (field instanceof HTMLTextAreaElement) {
        field.focus({ preventScroll: true });
        field.scrollIntoView?.({ behavior: "smooth", block: "center" });
      }
      return;
    }
    setBusyId(userId);
    const result = await apiRequest(`/api/v1/admin/identity/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ decision, reason: decisionReason }),
    });
    setBusyId(null);
    if (!result.success) {
      if (result.error.code === "VALIDATION_ERROR") setReasonError(result.error.message);
      else setError(result.error.message);
      return;
    }
    setRejectingId(null);
    setReason("");
    setReasonError(null);
    showToast("success", copy[locale].revamp.common.saved);
    await load();
  }

  return (
    <div className="space-y-4">
      {error && <FormMessage tone="error">{error}</FormMessage>}

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="identity-status">{t.verificationNav}</Label>
          <select
            id="identity-status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-10 rounded-control border border-line-strong bg-surface px-3 text-sm"
          >
            <option value="PENDING">PENDING</option>
            <option value="VERIFIED">VERIFIED</option>
            <option value="REJECTED">REJECTED</option>
            <option value="">—</option>
          </select>
        </div>
        {queue && (
          <p className="text-xs text-ink-subtle">
            {t.queueCounts
              .replace("{pending}", String(queue.counts.pending))
              .replace("{verified}", String(queue.counts.verified))
              .replace("{rejected}", String(queue.counts.rejected))}
          </p>
        )}
      </div>

      {!queue ? (
        <p className="text-sm text-ink-subtle">{t.saving}</p>
      ) : queue.submissions.length === 0 ? (
        <p className="text-sm text-ink-subtle">{t.noSubmissions}</p>
      ) : (
        <ul className="space-y-3">
          {queue.submissions.map((submission) => {
            const busy = busyId === submission.userId;
            return (
              <li
                key={submission.userId}
                className="rounded-control border border-line px-4 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-ink">
                      {submission.resident.name}
                      <span className="ml-2 text-xs font-normal text-ink-subtle">
                        {submission.resident.email}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {t.identityDoc}: {submission.method ?? "—"}
                      {submission.idTypeLabel ? ` (${submission.idTypeLabel})` : ""}
                      {submission.idNumberLast4
                        ? ` · ••••${submission.idNumberLast4}`
                        : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-subtle">
                      {submission.submittedAt
                        ? submission.submittedAt.slice(0, 10)
                        : ""}
                      {submission.reviewedBy
                        ? ` · ${submission.reviewedBy.name}`
                        : ""}
                    </p>
                    {submission.decisionReason && (
                      <p className="mt-1 text-xs text-ink-muted">
                        {t.decisionReason}: {submission.decisionReason}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={STATUS_TONE[submission.status] ?? "gray"}>
                      {submission.status}
                    </Badge>
                    {submission.idImageUrl && openImageFor !== submission.userId && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setOpenImageFor(submission.userId)}
                      >
                        {t.viewDoc}
                      </Button>
                    )}
                    {submission.hasIdImage && !submission.idImageUrl && (
                      <p className="text-xs text-ink-muted">{t.viewDoc}: —</p>
                    )}
                    {submission.status === "PENDING" && (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          loading={busy && rejectingId !== submission.userId}
                          disabled={busy}
                          onClick={() => decide(submission.userId, "VERIFIED")}
                        >
                          {t.approve}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            setRejectingId(submission.userId);
                            setReason("");
                            setReasonError(null);
                          }}
                        >
                          {t.reject}
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {submission.idImageUrl && openImageFor === submission.userId && (
                  <div className="mt-3 border-t border-line pt-3">
                    <p className="mb-2 text-xs font-medium text-ink">{t.viewDoc}</p>
                    <UploadedPhoto
                      src={`/api/v1/admin/identity/${submission.userId}/image`}
                      alt={`${submission.resident.name} — ${t.identityDoc}`}
                      locale={locale}
                    />
                  </div>
                )}

                {rejectingId === submission.userId && (
                  <div className="mt-3 space-y-2 border-t border-line pt-3">
                    <Label htmlFor={`reason-${submission.userId}`} required>
                      {t.decisionReason}
                    </Label>
                    <Textarea
                      id={`reason-${submission.userId}`}
                      value={reason}
                      required
                      aria-required="true"
                      invalid={Boolean(reasonError)}
                      rows={3}
                      maxLength={500}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder={t.rejectingHelp}
                      aria-describedby={reasonError ? `reason-${submission.userId}-error` : undefined}
                    />
                    {reasonError && (
                      <FieldError id={`reason-${submission.userId}-error`}>{reasonError}</FieldError>
                    )}
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        loading={busy}
                        disabled={busy}
                        onClick={() =>
                          decide(submission.userId, "REJECTED", reason.trim())
                        }
                      >
                        {t.reject}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setRejectingId(null)}
                      >
                        {copy[locale].revamp.common.cancel}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
