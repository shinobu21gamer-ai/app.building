"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label, Select, Textarea } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { copy, type Locale } from "@/lib/i18n";

export type FieldCheckView = {
  id: number;
  status: string;
  instructions: string;
  finding: string | null;
  findingNotes: string | null;
  findingPhotoUrl: string | null;
  reviewNote: string | null;
  assigneeId: number;
  assigneeName: string;
  requestedByName: string;
};

export type RosterOption = { id: number; name: string; roleLabel: string };

type Copy = (typeof copy)["en"]["revamp"]["workflow"]["fieldCheck"];

function findingLabel(t: Copy, finding: string | null): string {
  if (finding === "CONFIRMED") return t.findingConfirmed;
  if (finding === "NOT_CONFIRMED") return t.findingNotConfirmed;
  if (finding === "CANNOT_VERIFY") return t.findingCannotVerify;
  return "";
}

function statusTone(status: string): "amber" | "blue" | "green" {
  if (status === "APPROVED") return "green";
  if (status === "SUBMITTED") return "blue";
  return "amber";
}

/** The assigned person records the finding on their own check. */
export function FieldCheckSubmitForm({
  checkId,
  locale = "en",
  onDone,
}: {
  checkId: number;
  locale?: Locale;
  onDone?: () => void;
}) {
  const t = copy[locale].revamp.workflow.fieldCheck;
  const router = useRouter();
  const [finding, setFinding] = useState<string>("CONFIRMED");
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.append("finding", finding);
    body.append("notes", notes);
    if (photo) body.append("photo", photo);
    const res = await apiRequest(`/api/v1/field-checks/${checkId}/submit`, {
      method: "POST",
      body,
    });
    setBusy(false);
    if (!res.success) {
      setError(res.error.message || t.error);
      return;
    }
    onDone?.();
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink">{t.finding}</legend>
        {(["CONFIRMED", "NOT_CONFIRMED", "CANNOT_VERIFY"] as const).map((value) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={`finding-${checkId}`}
              value={value}
              checked={finding === value}
              onChange={() => setFinding(value)}
            />
            {findingLabel(t, value)}
          </label>
        ))}
      </fieldset>
      <div className="space-y-1">
        <Label htmlFor={`notes-${checkId}`}>{t.notes}</Label>
        <Textarea
          id={`notes-${checkId}`}
          rows={3}
          maxLength={1000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`photo-${checkId}`}>{t.photo}</Label>
        <Input
          id={`photo-${checkId}`}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
        />
      </div>
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <Button type="submit" loading={busy} disabled={busy}>
        {t.submit}
      </Button>
    </form>
  );
}

/**
 * Field checks on a case: request one, see the findings, and review a submitted
 * finding. The assigned person sees their own submit form inline.
 */
export function FieldCheckPanel({
  concernId,
  locale = "en",
  checks,
  roster,
  caseStatus,
  canRequest,
  canReview,
  currentUserId,
}: {
  concernId: number;
  locale?: Locale;
  checks: FieldCheckView[];
  roster: RosterOption[];
  caseStatus: string;
  canRequest: boolean;
  canReview: boolean;
  currentUserId: number;
}) {
  const t = copy[locale].revamp.workflow.fieldCheck;
  const router = useRouter();
  const [assigneeId, setAssigneeId] = useState<string>(roster[0] ? String(roster[0].id) : "");
  const [instructions, setInstructions] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | "request" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = checks.some((check) => check.status === "PENDING" || check.status === "SUBMITTED");
  const showRequest = canRequest && caseStatus === "ASSIGNED" && !open;

  async function request(event: React.FormEvent) {
    event.preventDefault();
    setBusy("request");
    setError(null);
    const res = await apiRequest(`/api/v1/concerns/${concernId}/field-checks`, {
      method: "POST",
      body: JSON.stringify({ assigneeId: Number(assigneeId), instructions }),
    });
    setBusy(null);
    if (!res.success) {
      setError(res.error.message || t.error);
      return;
    }
    setInstructions("");
    router.refresh();
  }

  async function review(checkId: number, decision: "APPROVE" | "REQUEST_RECHECK") {
    setBusy(checkId);
    setError(null);
    const res = await apiRequest(`/api/v1/field-checks/${checkId}/review`, {
      method: "POST",
      body: JSON.stringify({ decision, note: reviewNotes[checkId] ?? "" }),
    });
    setBusy(null);
    if (!res.success) {
      setError(res.error.message || t.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {open && <p className="text-sm text-ink-subtle">{t.open}</p>}

      {checks.length > 0 && (
        <ul className="space-y-3">
          {checks.map((check) => {
            const reviewing = canReview && check.status === "SUBMITTED";
            const isAssignee = check.assigneeId === currentUserId;
            return (
              <li key={check.id} className="space-y-2 rounded-xl border border-line p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(check.status)}>
                    {check.status === "APPROVED"
                      ? t.statusApproved
                      : check.status === "SUBMITTED"
                        ? t.statusSubmitted
                        : t.statusPending}
                  </Badge>
                  <span className="text-sm text-ink-subtle">
                    {t.assignedTo}: {check.assigneeName} · {t.requestedBy} {check.requestedByName}
                  </span>
                </div>
                <p className="text-sm text-ink">{check.instructions}</p>
                {check.finding && (
                  <div className="space-y-1 text-sm">
                    <p>
                      <span className="font-medium">{t.findingResult}:</span>{" "}
                      {findingLabel(t, check.finding)}
                    </p>
                    {check.findingNotes && <p className="text-ink-subtle">{check.findingNotes}</p>}
                    {check.findingPhotoUrl && (
                      <a
                        href={check.findingPhotoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand underline"
                      >
                        {t.photo}
                      </a>
                    )}
                  </div>
                )}
                {check.reviewNote && (
                  <p className="text-sm text-ink-subtle">
                    {t.reviewNote}: {check.reviewNote}
                  </p>
                )}

                {reviewing && (
                  <div className="space-y-2 border-t border-line pt-3">
                    {check.finding === "NOT_CONFIRMED" && (
                      <p className="text-sm text-warn">{t.closeWarning}</p>
                    )}
                    <div className="space-y-1">
                      <Label htmlFor={`review-${check.id}`}>{t.reviewNote}</Label>
                      <Textarea
                        id={`review-${check.id}`}
                        rows={2}
                        maxLength={1000}
                        value={reviewNotes[check.id] ?? ""}
                        onChange={(e) =>
                          setReviewNotes((prev) => ({ ...prev, [check.id]: e.target.value }))
                        }
                      />
                      <p className="text-xs text-ink-subtle">{t.reviewNoteHint}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        loading={busy === check.id}
                        disabled={busy !== null}
                        onClick={() => review(check.id, "APPROVE")}
                      >
                        {t.approve}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => review(check.id, "REQUEST_RECHECK")}
                      >
                        {t.sendBack}
                      </Button>
                    </div>
                  </div>
                )}

                {check.status === "PENDING" && isAssignee && (
                  <div className="border-t border-line pt-3">
                    <FieldCheckSubmitForm checkId={check.id} locale={locale} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {showRequest &&
        (roster.length === 0 ? (
          <p className="text-sm text-ink-subtle">{t.noEligible}</p>
        ) : (
          <form onSubmit={request} className="space-y-3 border-t border-line pt-4">
            <h3 className="text-sm font-semibold text-ink">{t.requestTitle}</h3>
            <div className="space-y-1">
              <Label htmlFor="fc-assignee">{t.assignee}</Label>
              <Select
                id="fc-assignee"
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
              >
                {roster.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} ({option.roleLabel})
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="fc-instructions">{t.instructions}</Label>
              <Textarea
                id="fc-instructions"
                rows={3}
                maxLength={500}
                required
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
              <p className="text-xs text-ink-subtle">{t.instructionsHint}</p>
            </div>
            {error && <FormMessage tone="error">{error}</FormMessage>}
            <Button type="submit" loading={busy === "request"} disabled={busy !== null || !assigneeId}>
              {t.send}
            </Button>
          </form>
        ))}
      {!showRequest && error && <FormMessage tone="error">{error}</FormMessage>}
    </div>
  );
}
