"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage, Label, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { apiRequest } from "@/lib/api-client";
import { extractApiError } from "@/lib/utils";
import { copy, type Locale } from "@/lib/i18n";

export type FieldCheckDeskItem = {
  id: number;
  status: string;
  instructions: string;
  finding: string | null;
  findingNotes: string | null;
  findingPhotoUrl: string | null;
  reviewNote: string | null;
  createdAt: string;
  caseId: number;
  caseNumber: string;
  caseTitle: string;
  caseStatus: string;
  officeName: string | null;
  locationAddress: string | null;
  locationPurok: string | null;
  mapUrl: string | null;
  assigneeName: string;
  requestedByName: string;
};

export type FieldCheckCaseOption = {
  id: number;
  caseNumber: string;
  title: string;
  /** SUBMITTED (straight from the inbox) or ASSIGNED (waiting for assessment). */
  caseStatus: string;
  assignedOfficeId: number | null;
  officeName: string | null;
  locationAddress: string | null;
  locationPurok: string | null;
  mapUrl: string | null;
};

/** Anything with a location on it: a check, or a case waiting for one. */
type PlaceLike = {
  locationAddress: string | null;
  locationPurok: string | null;
  mapUrl: string | null;
};

export type FieldCheckStaffOption = {
  id: number;
  name: string;
  roleLabel: string;
  officeId: number | null;
  officeName: string | null;
};

/**
 * The admin's field-check desk: what is out with a checker, what came back and
 * needs an answer, and the cases that still need somebody sent.
 *
 * Sent checks go through `POST /api/v1/concerns/[id]/field-checks`; the answer
 * goes through `POST /api/v1/field-checks/[id]/review`. Approving a "not
 * confirmed" finding closes the case as unfounded, which is the only way a
 * report that is not real leaves the board.
 */
export function FieldCheckDesk({
  toReview,
  waiting,
  decided,
  cases,
  staff,
  locale = "en",
}: {
  toReview: FieldCheckDeskItem[];
  waiting: FieldCheckDeskItem[];
  decided: FieldCheckDeskItem[];
  cases: FieldCheckCaseOption[];
  staff: FieldCheckStaffOption[];
  locale?: Locale;
}) {
  const t = copy[locale].admin.fieldCheck;
  const router = useRouter();
  const { showToast } = useToast();

  const [caseId, setCaseId] = useState(cases[0] ? String(cases[0].id) : "");
  const [assigneeId, setAssigneeId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | "request" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedCase = cases.find((row) => String(row.id) === caseId) ?? null;

  // The case office's own staff come first; only when that office has nobody is
  // the rest of the roster offered (flagged). The service enforces the same
  // rule, so a picker that lies cannot send the wrong person.
  const roster = (() => {
    if (!selectedCase) return [];
    const own = staff.filter(
      (person) =>
        selectedCase.assignedOfficeId === null ||
        person.officeId === null ||
        person.officeId === selectedCase.assignedOfficeId
    );
    if (own.length > 0 || selectedCase.assignedOfficeId === null) {
      return own.map((person) => ({ ...person, otherOffice: false }));
    }
    return staff.map((person) => ({ ...person, otherOffice: true }));
  })();

  const chosenAssignee = roster.find((person) => String(person.id) === assigneeId) ?? null;

  function findingLabel(finding: string | null): string {
    if (finding === "CONFIRMED") return t.findingConfirmed;
    if (finding === "NOT_CONFIRMED") return t.findingNotConfirmed;
    if (finding === "CANNOT_VERIFY") return t.findingCannotVerify;
    return "—";
  }

  async function request(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const id = Number(caseId);
    const personId = Number(assigneeId);
    if (!Number.isInteger(id) || id <= 0) {
      setError(t.sendEmpty);
      return;
    }
    if (!Number.isInteger(personId) || personId <= 0) {
      setError(t.error);
      return;
    }

    setBusy("request");
    const result = await apiRequest(`/api/v1/concerns/${id}/field-checks`, {
      method: "POST",
      body: JSON.stringify({ assigneeId: personId, instructions }),
    });
    setBusy(null);

    if (!result.success) {
      const message = extractApiError(result.error);
      setError(message);
      showToast("error", message);
      return;
    }

    setSuccess(t.sent);
    showToast("success", t.sent);
    setInstructions("");
    setAssigneeId("");
    router.refresh();
  }

  async function review(checkId: number, decision: "APPROVE" | "REQUEST_RECHECK") {
    setError(null);
    setSuccess(null);
    setBusy(checkId);
    const result = await apiRequest(`/api/v1/field-checks/${checkId}/review`, {
      method: "POST",
      body: JSON.stringify({ decision, note: reviewNotes[checkId] ?? "" }),
    });
    setBusy(null);

    if (!result.success) {
      const message = extractApiError(result.error);
      setError(message);
      showToast("error", message);
      return;
    }

    setSuccess(t.reviewed);
    showToast("success", t.reviewed);
    router.refresh();
  }

  function locationLine(item: PlaceLike) {
    const place =
      [
        item.locationAddress,
        item.locationPurok ? `${t.locationPurok}: ${item.locationPurok}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || t.locationNone;
    return (
      <p className="inline-flex flex-wrap items-center gap-x-2 text-sm text-ink-muted">
        <MapPin size={14} className="text-ink-subtle" />
        <span>
          <span className="font-medium">{t.location}:</span> {place}
        </span>
        {item.mapUrl && (
          <a
            href={item.mapUrl}
            target="_blank"
            rel="noreferrer"
            className="text-brand underline"
          >
            {t.locationMap}
          </a>
        )}
      </p>
    );
  }

  function checkCard(item: FieldCheckDeskItem, showReview: boolean) {
    const reviewing = showReview && item.status === "SUBMITTED";
    return (
      <li key={item.id} className="space-y-2 rounded-card border border-line p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-ink">{item.caseNumber}</span>
          <Badge
            tone={
              item.status === "APPROVED"
                ? "green"
                : item.status === "SUBMITTED"
                  ? "blue"
                  : "amber"
            }
          >
            {item.status === "APPROVED"
              ? t.statusApproved
              : item.status === "SUBMITTED"
                ? t.statusSubmitted
                : t.statusPending}
          </Badge>
          {item.finding && <Badge tone="violet">{findingLabel(item.finding)}</Badge>}
          <a
            href={`/official/concerns/${item.caseId}`}
            className="text-sm font-semibold text-brand-700 underline"
          >
            {t.openCase}
          </a>
        </div>

        <p className="text-sm text-ink-muted">{item.caseTitle}</p>
        <p className="text-xs text-ink-subtle">
          {item.officeName ?? "—"} · {t.assignedTo}: {item.assigneeName} ·{" "}
          {t.requestedBy}: {item.requestedByName}
        </p>
        {locationLine(item)}

        <p className="text-sm text-ink">
          <span className="font-medium">{t.instructions}:</span> {item.instructions}
        </p>

        {item.finding && (
          <div className="space-y-1 text-sm">
            <p>
              <span className="font-medium">{t.finding}:</span>{" "}
              {findingLabel(item.finding)}
            </p>
            {item.findingNotes && (
              <p className="text-ink-muted">
                <span className="font-medium">{t.notes}:</span> {item.findingNotes}
              </p>
            )}
            {item.findingPhotoUrl && (
              <a
                href={item.findingPhotoUrl}
                target="_blank"
                rel="noreferrer"
                className="text-brand underline"
              >
                {t.photo}
              </a>
            )}
          </div>
        )}

        {item.reviewNote && (
          <p className="text-sm text-ink-subtle">
            {t.reviewNote}: {item.reviewNote}
          </p>
        )}

        {reviewing && (
          <div className="space-y-2 border-t border-line pt-3">
            {item.finding === "NOT_CONFIRMED" && (
              <p className="text-sm text-warn">{t.closeWarning}</p>
            )}
            <div className="space-y-1">
              <Label htmlFor={`desk-review-${item.id}`}>{t.reviewNote}</Label>
              <Textarea
                id={`desk-review-${item.id}`}
                rows={2}
                maxLength={1000}
                value={reviewNotes[item.id] ?? ""}
                onChange={(event) =>
                  setReviewNotes((prev) => ({ ...prev, [item.id]: event.target.value }))
                }
              />
              <p className="text-xs text-ink-subtle">{t.reviewNoteHint}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                loading={busy === item.id}
                disabled={busy !== null}
                onClick={() => review(item.id, "APPROVE")}
              >
                {t.approve}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={() => review(item.id, "REQUEST_RECHECK")}
              >
                {t.sendBack}
              </Button>
            </div>
          </div>
        )}
      </li>
    );
  }

  return (
    <div className="space-y-8">
      {success && <FormMessage tone="success">{success}</FormMessage>}
      {error && <FormMessage tone="error">{error}</FormMessage>}

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-ink">{t.awaitingReview}</h2>
        {toReview.length === 0 ? (
          <p className="text-sm text-ink-subtle">{t.awaitingReviewEmpty}</p>
        ) : (
          <ul className="space-y-3">{toReview.map((item) => checkCard(item, true))}</ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-ink">{t.waitingOnChecker}</h2>
        {waiting.length === 0 ? (
          <p className="text-sm text-ink-subtle">{t.waitingOnCheckerEmpty}</p>
        ) : (
          <ul className="space-y-3">{waiting.map((item) => checkCard(item, false))}</ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-ink">{t.sendTitle}</h2>
        {cases.length === 0 ? (
          <p className="text-sm text-ink-subtle">{t.sendEmpty}</p>
        ) : (
          <form
            onSubmit={request}
            className="space-y-3 rounded-card border border-line bg-surface-muted p-4"
          >
            <p className="text-xs leading-relaxed text-ink-subtle">{t.sendLead}</p>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="desk-case">{t.pickCase}</Label>
                <Select
                  id="desk-case"
                  value={caseId}
                  onChange={(event) => {
                    setCaseId(event.target.value);
                    setAssigneeId("");
                  }}
                  required
                >
                  {cases.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.caseStatus === "SUBMITTED" ? `${t.newReport} · ` : ""}
                      {row.caseNumber} · {row.title}
                      {row.officeName ? ` (${row.officeName})` : ""}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="desk-assignee">{t.pickPerson}</Label>
                <Select
                  id="desk-assignee"
                  value={assigneeId}
                  onChange={(event) => setAssigneeId(event.target.value)}
                  required
                >
                  <option value="">—</option>
                  {roster.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name} ({person.roleLabel}
                      {person.officeName ? ` · ${person.officeName}` : ""})
                    </option>
                  ))}
                </Select>
                {chosenAssignee?.otherOffice && (
                  <p className="mt-1 text-xs text-ink-subtle">{t.otherOfficeHint}</p>
                )}
              </div>
            </div>

            {selectedCase && locationLine(selectedCase)}

            <div className="space-y-1">
              <Label htmlFor="desk-instructions" required>
                {t.instructions}
              </Label>
              <Textarea
                id="desk-instructions"
                rows={3}
                maxLength={500}
                required
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                placeholder={t.instructionsPlaceholder}
              />
            </div>

            <Button type="submit" loading={busy === "request"} disabled={busy !== null}>
              <Send size={16} />
              {busy === "request" ? t.sending : t.send}
            </Button>
          </form>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-ink">{t.decided}</h2>
        {decided.length === 0 ? (
          <p className="text-sm text-ink-subtle">{t.decidedEmpty}</p>
        ) : (
          <ul className="space-y-3">{decided.map((item) => checkCard(item, false))}</ul>
        )}
      </section>
    </div>
  );
}
