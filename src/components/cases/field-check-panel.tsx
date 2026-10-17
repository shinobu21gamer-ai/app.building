"use client";

import { UploadedPhoto } from "@/components/ui/uploaded-photo";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FieldRequirement,
  FormMessage,
  Label,
  Select,
  Textarea
} from "@/components/ui/field";
import { PhotoPicker } from "@/components/ui/photo-picker";
import { apiRequest } from "@/lib/api-client";
import { canRequestFieldCheck } from "@/lib/cases/field-check-rules";
import { copy, type Locale } from "@/lib/i18n";
import { formatDateTime } from "@/lib/format";

export type FieldCheckResidentReply = {
  id: number;
  message: string;
  authorName: string;
  createdAt: string;
};

export type FieldCheckView = {
  id: number;
  residentReplies?: FieldCheckResidentReply[];
  status: string;
  instructions: string;
  finding: string | null;
  findingNotes: string | null;
  findingPhotoUrl: string | null;
  /** The record names a site photo but its bytes are not on the server. */
  findingPhotoMissing?: boolean;
  reviewNote: string | null;
  assigneeId: number;
  assigneeName: string;
  requestedByName: string;
};

export type RosterOption = {
  id: number;
  name: string;
  roleLabel: string;
  officeName?: string | null;
  /** True when this person is being offered because nobody local is free. */
  otherOffice?: boolean;
};

/** Where the resident said the concern is — what the checker has to go and see. */
export type FieldCheckLocation = {
  address: string | null;
  purok: string | null;
  lat: number | null;
  lng: number | null;
  mapUrl: string | null;
};

/**
 * The location of the case, as the resident pinned it. It travels with every
 * field-check card and with the form the checker submits from, so the person
 * who is sent knows exactly which spot to look at.
 */
function LocationLine({
  location,
  labels,
}: {
  location: FieldCheckLocation | null;
  labels: { title: string; purok: string; map: string; none: string };
}) {
  const place =
    [location?.address, location?.purok ? `${labels.purok}: ${location.purok}` : null]
      .filter(Boolean)
      .join(" · ") || labels.none;

  return (
    <div className="text-sm">
      <p>
        <span className="font-medium">{labels.title}:</span> {place}
      </p>
      {location?.mapUrl && (
        <p className="mt-0.5">
          <a
            href={location.mapUrl}
            target="_blank"
            rel="noreferrer"
            className="text-brand underline"
          >
            {labels.map}
          </a>
        </p>
      )}
    </div>
  );
}

type Copy = (typeof copy)["en"]["revamp"]["workflow"]["fieldCheck"];

/**
 * Case number, title, and the note the admin (or official) sent with the
 * check. Without a "Notes:" label that line looked like more of the title.
 */
export function FieldCheckHeading({
  caseNumber,
  title,
  instructions,
  locale = "en",
}: {
  caseNumber: string;
  title: string;
  instructions: string;
  locale?: Locale;
}) {
  const t = copy[locale].revamp.workflow.fieldCheck;
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium text-ink break-words">
        {t.caseLabel} {caseNumber} · {title}
      </p>
      {instructions.trim() ? (
        <p className="text-sm text-ink">
          <span className="font-medium">{t.notes}:</span>{" "}
          <span className="whitespace-pre-wrap break-words">{instructions}</span>
        </p>
      ) : null}
    </div>
  );
}

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
  location = null,
  onDone,
}: {
  checkId: number;
  locale?: Locale;
  /** Where the resident placed the concern; shown before the finding is given. */
  location?: FieldCheckLocation | null;
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
    if (!photo) {
      setError(t.photoRequired);
      return;
    }
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.append("finding", finding);
    body.append("notes", notes);
    body.append("photo", photo);
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
      <LocationLine
        location={location}
        labels={{
          title: t.location,
          purok: t.locationPurok,
          map: t.locationMap,
          none: t.locationNone,
        }}
      />

      <fieldset className="space-y-2">
        <legend className="flex flex-wrap items-baseline justify-between gap-2 text-sm font-medium text-ink">
          <span>{t.finding}</span>
          <FieldRequirement required />
        </legend>
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
        <Label htmlFor={`notes-${checkId}`} optional>
          {t.notes}
        </Label>
        <Textarea
          id={`notes-${checkId}`}
          rows={3}
          maxLength={1000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <PhotoPicker
        id={`photo-${checkId}`}
        name="photo"
        label={t.photo}
        hint={t.photoHint}
        required
        onChange={(file) => setPhoto(file)}
        locale={locale}
      />
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <Button type="submit" loading={busy} disabled={busy || !photo}>
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
  location = null,
  concernPhotoUrl = null,
  caseStatus,
  canRequest,
  canReview,
  currentUserId,
}: {
  concernId: number;
  locale?: Locale;
  checks: FieldCheckView[];
  roster: RosterOption[];
  /** The resident's location, shown on every check so the checker knows where to go. */
  location?: FieldCheckLocation | null;
  /** The photo on the original report, for comparison with the site photo. */
  concernPhotoUrl?: string | null;
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
  // Step 1: a check can go out from the moment the report arrives, and stays
  // possible while the case waits for its assessment. It closes once the case
  // moves on — and while a check is open, there is nothing to send.
  const showRequest = canRequest && canRequestFieldCheck(caseStatus) && !open;

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
            const residentReplies = check.residentReplies ?? [];
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
                {check.instructions.trim() ? (
                  <p className="text-sm text-ink">
                    <span className="font-medium">{t.notes}:</span>{" "}
                    <span className="whitespace-pre-wrap break-words">
                      {check.instructions}
                    </span>
                  </p>
                ) : null}
                {residentReplies.length > 0 && (
                  <div className="space-y-2 rounded-control border border-brand-200 bg-brand-50/60 p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge tone="neutral">{t.residentReply}</Badge>
                      <span className="font-medium text-ink">
                        {t.residentReplyBy
                          .replace("{name}", residentReplies[0].authorName)
                          .replace(
                            "{date}",
                            formatDateTime(new Date(residentReplies[0].createdAt))
                          )}
                      </span>
                    </div>
                    <ol className="space-y-2">
                      {residentReplies.map((reply) => (
                        <li key={reply.id} className="whitespace-pre-wrap break-words text-ink-muted">
                          {reply.message}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                <LocationLine
                  location={location}
                  labels={{
                    title: t.location,
                    purok: t.locationPurok,
                    map: t.locationMap,
                    none: t.locationNone,
                  }}
                />
                {check.finding && (
                  <div className="space-y-2 rounded-control border border-line bg-surface-sunken p-3 text-sm">
                    <p className="font-semibold text-ink">
                      {t.checkerReply.replace("{name}", check.assigneeName)}
                    </p>
                    <p>
                      <span className="font-medium">{t.findingResult}:</span>{" "}
                      {findingLabel(t, check.finding)}
                    </p>
                    {check.findingNotes && (
                      <p className="whitespace-pre-wrap break-words text-ink-muted">
                        <span className="font-medium text-ink">{t.notes}:</span>{" "}
                        {check.findingNotes}
                      </p>
                    )}
                    <div className="grid gap-3 sm:grid-cols-2">
                      {concernPhotoUrl ? (
                        <div>
                          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                            {t.residentPhoto}
                          </p>
                          <UploadedPhoto src={concernPhotoUrl} alt={t.residentPhoto} locale={locale} />
                        </div>
                      ) : null}
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                          {t.sitePhoto}
                        </p>
                        {check.findingPhotoMissing ? (
                          <p role="status" className="text-sm text-ink-muted">
                            {copy[locale].photoViewer.gone}
                          </p>
                        ) : check.findingPhotoUrl ? (
                          <UploadedPhoto src={check.findingPhotoUrl} alt={t.sitePhoto} locale={locale} />
                        ) : (
                          <p className="text-sm text-amber-800">{t.approveNeedsPhoto}</p>
                        )}
                      </div>
                    </div>
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
                      <Label htmlFor={`review-${check.id}`} optional>
                        {t.reviewNote}
                      </Label>
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
                        disabled={busy !== null || !check.findingPhotoUrl}
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
                    <FieldCheckSubmitForm
                      checkId={check.id}
                      locale={locale}
                      location={location}
                    />
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
              <Label htmlFor="fc-assignee" required>
                {t.assignee}
              </Label>
              <Select
                id="fc-assignee"
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
              >
                {roster.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} ({option.roleLabel}
                    {option.officeName ? ` · ${option.officeName}` : ""})
                  </option>
                ))}
              </Select>
              {roster.some((option) => option.otherOffice) && (
                <p className="mt-1 text-xs text-ink-subtle">{t.otherOfficeHint}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="fc-instructions" required>
                {t.instructions}
              </Label>
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
