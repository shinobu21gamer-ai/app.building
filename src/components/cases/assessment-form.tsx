"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  FormMessage,
  Input,
  Label,
  Textarea,
} from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { copy, type Locale } from "@/lib/i18n";

const inputStyles =
  "h-10 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

const moneyStyles = inputStyles;

export type AssessmentDefaults = {
  eligibilityChecked: boolean;
  eligibilityNotes: string | null;
  inspectionRequired: boolean;
  inspectionNotes: string | null;
  inspectionCompleted: boolean;
  resourcesVerified: boolean;
  resourcesVerificationNotes: string | null;
  approvalRequired: boolean;
  approvalNotes: string | null;
  approved: boolean;
  workersNeeded: number | null;
  estimatedDurationMinutes: number | null;
  equipmentNotes: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  laborCost: string | null;
  materialsCost: string | null;
  equipmentCost: string | null;
  otherCost: string | null;
};

type Checkbox = { name: string; label: string; hint?: string; defaultChecked: boolean };

/**
 * The UNDER_ASSESSMENT form: the four checks, the manpower plan and the
 * labour-inclusive cost estimate. Workers needed, the duration and the
 * equipment notes are the fields the workflow actually gates on, so they are
 * marked as required.
 */
export function AssessmentForm({
  concernId,
  locale = "en",
  defaults,
  legacyCase,
}: {
  concernId: number;
  locale?: Locale;
  defaults: AssessmentDefaults | null;
  legacyCase?: boolean;
}) {
  const t = copy[locale].revamp.workflow;
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [inspectionRequired, setInspectionRequired] = useState(
    defaults?.inspectionRequired ?? false
  );
  const [approvalRequired, setApprovalRequired] = useState(
    defaults?.approvalRequired ?? false
  );

  const durationMinutes = defaults?.estimatedDurationMinutes ?? 0;
  const defaultHours = durationMinutes > 0 ? Math.floor(durationMinutes / 60) : "";
  const defaultMinutes = durationMinutes > 0 ? durationMinutes % 60 : "";

  // The pickers work in the browser's own local time; plans are stored as
  // instants. Show and compare them in the barangay's timezone (Asia/Manila),
  // which is what the people filling this form read off the clock.
  const toLocalInput = (value: string | null) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const part = (type: string) =>
      parts.find((entry) => entry.type === type)?.value ?? "00";
    const hour = part("hour") === "24" ? "00" : part("hour");
    return `${part("year")}-${part("month")}-${part("day")}T${hour}:${part("minute")}`;
  };

  // A new plan may not start in the past. A plan that is already recorded keeps
  // its own window as the floor, so re-saving a running case stays possible.
  const nowLocal = toLocalInput(new Date().toISOString());
  const storedFloor = [
    toLocalInput(defaults?.scheduledStartAt ?? null),
    toLocalInput(defaults?.scheduledEndAt ?? null),
  ]
    .filter(Boolean)
    .sort()[0];
  const planMin =
    storedFloor && storedFloor < nowLocal ? storedFloor : nowLocal;

  const checkboxes: Checkbox[] = [
    {
      name: "eligibilityChecked",
      label: t.eligibility,
      hint: t.eligibilityHint,
      defaultChecked: defaults?.eligibilityChecked ?? false,
    },
    {
      name: "inspectionRequired",
      label: t.inspection,
      defaultChecked: defaults?.inspectionRequired ?? false,
    },
    {
      name: "inspectionCompleted",
      label: t.inspectionCompleted,
      defaultChecked: defaults?.inspectionCompleted ?? false,
    },
    {
      name: "resourcesVerified",
      label: t.resources,
      hint: t.resourcesHint,
      defaultChecked: defaults?.resourcesVerified ?? false,
    },
    {
      name: "approvalRequired",
      label: t.approval,
      defaultChecked: defaults?.approvalRequired ?? false,
    },
    {
      name: "approved",
      label: t.approved,
      defaultChecked: defaults?.approved ?? false,
    },
  ];

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSuccess(null);

    const data = new FormData(event.currentTarget);
    const hours = Number(data.get("durationHours") ?? 0);
    const minutes = Number(data.get("durationMinutes") ?? 0);

    const payload = {
      eligibilityChecked: data.get("eligibilityChecked") === "on",
      eligibilityNotes: String(data.get("eligibilityNotes") ?? ""),
      inspectionRequired: data.get("inspectionRequired") === "on",
      inspectionCompleted: data.get("inspectionCompleted") === "on",
      inspectionNotes: String(data.get("inspectionNotes") ?? ""),
      resourcesVerified: data.get("resourcesVerified") === "on",
      resourcesVerificationNotes: String(
        data.get("resourcesVerificationNotes") ?? ""
      ),
      approvalRequired: data.get("approvalRequired") === "on",
      approved: data.get("approved") === "on",
      approvalNotes: String(data.get("approvalNotes") ?? ""),
      workersNeeded: Number(data.get("workersNeeded") ?? 0),
      estimatedDurationMinutes: Math.max(0, hours) * 60 + Math.max(0, minutes),
      equipmentNotes: String(data.get("equipmentNotes") ?? ""),
      scheduledStartAt: String(data.get("scheduledStartAt") ?? ""),
      scheduledEndAt: String(data.get("scheduledEndAt") ?? ""),
      laborCost: String(data.get("laborCost") ?? ""),
      materialsCost: String(data.get("materialsCost") ?? ""),
      equipmentCost: String(data.get("equipmentCost") ?? ""),
      otherCost: String(data.get("otherCost") ?? ""),
    };

    if (!Number.isInteger(payload.workersNeeded) || payload.workersNeeded < 1) {
      setFormError(t.assessmentRequired);
      return;
    }
    if (payload.estimatedDurationMinutes < 15) {
      setFormError(t.assessmentRequired);
      return;
    }
    if (payload.equipmentNotes.trim().length < 3) {
      setFormError(t.assessmentRequired);
      return;
    }

    setSubmitting(true);
    const result = await apiRequest<{ caseNumber: string; cost: { totalCost: number } }>(
      `/api/v1/concerns/${concernId}/assessment`,
      { method: "POST", body: JSON.stringify(payload) }
    );
    setSubmitting(false);

    if (!result.success) {
      if (
        result.error.code === "VALIDATION_ERROR" &&
        Array.isArray(result.error.details)
      ) {
        const details = result.error.details as { message: string }[];
        setFormError(details.map((detail) => detail.message).join(" "));
      } else {
        setFormError(result.error.message);
      }
      return;
    }

    setSuccess(`${t.assessmentSaved} ${result.data.caseNumber}`);
    router.refresh();
  }

  const notesField = (
    name: string,
    label: string,
    defaultValue: string | null
  ) => (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <Textarea id={name} name={name} rows={2} maxLength={1000} defaultValue={defaultValue ?? ""} />
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {legacyCase && (
        <FormMessage tone="success">{t.legacyCase}</FormMessage>
      )}
      {success && <FormMessage tone="success">{success}</FormMessage>}
      {formError && <FormMessage tone="error">{formError}</FormMessage>}

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink">
          {t.assessmentTitle}
        </legend>
        <p className="text-xs text-ink-subtle">{t.assessmentDesc}</p>

        {checkboxes.map((box) => {
          const hidden =
            (box.name === "inspectionCompleted" && !inspectionRequired) ||
            (box.name === "approved" && !approvalRequired);
          if (hidden) return null;
          return (
            <label
              key={box.name}
              className="flex items-start gap-2 text-sm text-ink-muted"
            >
              <input
                type="checkbox"
                name={box.name}
                defaultChecked={box.defaultChecked}
                onChange={(event) => {
                  if (box.name === "inspectionRequired") {
                    setInspectionRequired(event.target.checked);
                  }
                  if (box.name === "approvalRequired") {
                    setApprovalRequired(event.target.checked);
                  }
                }}
                className="mt-0.5 h-4 w-4 rounded border-line-strong"
              />
              <span>
                {box.label}
                {box.hint && (
                  <span className="block text-xs text-ink-subtle">{box.hint}</span>
                )}
              </span>
            </label>
          );
        })}

        <div className="grid gap-3 sm:grid-cols-2">
          {notesField("eligibilityNotes", t.eligibilityNotes, defaults?.eligibilityNotes ?? null)}
          {notesField("inspectionNotes", t.inspectionNotes, defaults?.inspectionNotes ?? null)}
          {notesField(
            "resourcesVerificationNotes",
            t.resourcesNotes,
            defaults?.resourcesVerificationNotes ?? null
          )}
          {notesField("approvalNotes", t.approvalNotes, defaults?.approvalNotes ?? null)}
        </div>
      </fieldset>

      <fieldset className="space-y-3 border-t border-line pt-5">
        <legend className="text-sm font-semibold text-ink">
          {t.manpowerTitle}
        </legend>
        <p className="text-xs text-ink-subtle">{t.manpowerDesc}</p>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="workersNeeded" required>
              {t.workersNeeded}
            </Label>
            <Input
              id="workersNeeded"
              name="workersNeeded"
              type="number"
              min={1}
              max={100}
              step={1}
              required
              defaultValue={defaults?.workersNeeded ?? ""}
            />
            <p className="mt-1 text-xs text-ink-subtle">{t.workersNeededHint}</p>
          </div>
          <div>
            <Label htmlFor="durationHours" required>
              {t.duration}
            </Label>
            <div className="flex gap-2">
              <Input
                id="durationHours"
                name="durationHours"
                type="number"
                min={0}
                max={2160}
                step={1}
                required
                aria-label={t.durationHours}
                defaultValue={defaultHours}
              />
              <Input
                id="durationMinutes"
                name="durationMinutes"
                type="number"
                min={0}
                max={59}
                step={5}
                aria-label={t.durationMinutes}
                defaultValue={defaultMinutes}
              />
            </div>
            <p className="mt-1 text-xs text-ink-subtle">
              {t.durationHours} · {t.durationMinutes}
            </p>
          </div>
          <div>
            <Label htmlFor="scheduledStart">{t.scheduledStart}</Label>
            <Input
              id="scheduledStart"
              name="scheduledStartAt"
              type="datetime-local"
              min={planMin}
              defaultValue={toLocalInput(defaults?.scheduledStartAt ?? null)}
            />
          </div>
          <div>
            <Label htmlFor="scheduledEnd">{t.scheduledEnd}</Label>
            <Input
              id="scheduledEnd"
              name="scheduledEndAt"
              type="datetime-local"
              min={planMin}
              defaultValue={toLocalInput(defaults?.scheduledEndAt ?? null)}
            />
            <p className="mt-1 text-xs text-ink-subtle">{t.scheduledHint}</p>
          </div>
        </div>

        <div>
          <Label htmlFor="equipmentNotes" required>
            {t.equipment}
          </Label>
          <Textarea
            id="equipmentNotes"
            name="equipmentNotes"
            rows={2}
            maxLength={500}
            required
            placeholder={t.equipmentPlaceholder}
            defaultValue={defaults?.equipmentNotes ?? ""}
          />
        </div>
      </fieldset>

      <fieldset className="space-y-3 border-t border-line pt-5">
        <legend className="text-sm font-semibold text-ink">
          {t.costTitle}
        </legend>
        <p className="text-xs text-ink-subtle">{t.costDesc}</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="laborCost">{t.labor}</Label>
            <Input
              id="laborCost"
              name="laborCost"
              type="number"
              min={0}
              step="0.01"
              className={moneyStyles}
              defaultValue={defaults?.laborCost ?? ""}
            />
            <p className="mt-1 text-xs text-ink-subtle">{t.laborHint}</p>
          </div>
          <div>
            <Label htmlFor="materialsCost">{t.materials}</Label>
            <Input
              id="materialsCost"
              name="materialsCost"
              type="number"
              min={0}
              step="0.01"
              defaultValue={defaults?.materialsCost ?? ""}
            />
          </div>
          <div>
            <Label htmlFor="equipmentCost">{t.equipmentCost}</Label>
            <Input
              id="equipmentCost"
              name="equipmentCost"
              type="number"
              min={0}
              step="0.01"
              defaultValue={defaults?.equipmentCost ?? ""}
            />
          </div>
          <div>
            <Label htmlFor="otherCost">{t.other}</Label>
            <Input
              id="otherCost"
              name="otherCost"
              type="number"
              min={0}
              step="0.01"
              defaultValue={defaults?.otherCost ?? ""}
            />
          </div>
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={submitting} loading={submitting}>
          {t.saveAssessment}
        </Button>
      </div>
    </form>
  );
}
