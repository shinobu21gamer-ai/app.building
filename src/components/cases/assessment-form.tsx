"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  FormMessage,
  Input,
  Label,
  Textarea,
} from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import type { MaterialSuggestion } from "@/lib/cases/materials-templates";
import { copy, type Locale } from "@/lib/i18n";
import { todayManila } from "@/lib/cases/action-date";

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
  materials: MaterialLineDefault[] | null;
};

export type MaterialLineDefault = {
  name: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  amount: string;
  note: string;
};

/** One editable materials row in the form state (figures as typed strings). */
type MaterialLine = MaterialLineDefault & { id: number };

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
  suggestions = [],
  legacyCase,
}: {
  concernId: number;
  locale?: Locale;
  defaults: AssessmentDefaults | null;
  /**
   * Suggested materials for this kind of concern (from its category/type).
   * Pre-fills the editor on a fresh assessment so the official adjusts
   * figures instead of typing the list; saved lines always win.
   */
  suggestions?: MaterialSuggestion[];
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
  // The materials list: what will be bought, line by line. The materials
  // total is their sum — the treasurer sets money aside against these lines,
  // not against a bare number.
  const nextMaterialId = useRef(1);
  const emptyMaterialLine = (): MaterialLine => ({
    id: nextMaterialId.current++,
    name: "",
    quantity: "",
    unit: "",
    unitPrice: "",
    amount: "",
    note: "",
  });
  // Saved lines win; on a fresh assessment the list for this kind of concern
  // is already chosen (road → cement and gravel, streetlight → lamps and
  // drivers), so the official adjusts figures instead of typing names. The
  // note stops the moment the list stops being the suggestion.
  const [suggested, setSuggested] = useState(
    !(defaults?.materials && defaults.materials.length > 0)
  );
  const [materials, setMaterials] = useState<MaterialLine[]>(() => {
    const saved = defaults?.materials ?? [];
    if (saved.length > 0) {
      return saved.map((line) => ({ ...line, id: nextMaterialId.current++ }));
    }
    if (suggestions.length > 0) {
      return suggestions.map((line) => ({
        ...line,
        note: "",
        id: nextMaterialId.current++,
      }));
    }
    return [emptyMaterialLine()];
  });
  const materialsTotal = materials.reduce((sum: number, line: MaterialLine) => {
    const value = Number(line.amount);
    return sum + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);
  const updateMaterial = (id: number, field: keyof MaterialLineDefault, value: string) => {
    setMaterials((rows) =>
      rows.map((row) => (row.id === id ? { ...row, [field]: value } : row))
    );
  };
  const removeMaterial = (id: number) => {
    setMaterials((rows) => rows.filter((row) => row.id !== id));
    setSuggested(false);
  };
  const addMaterial = () => {
    setSuggested(false);
    setMaterials((rows) => [
      ...rows,
      {
        id: nextMaterialId.current++,
        name: "",
        quantity: "",
        unit: "",
        unitPrice: "",
        amount: "",
        note: "",
      },
    ]);
  };
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
  // A plan may not stretch past the end of today in Manila: the picker keeps
  // the browser honest and the API re-checks the same boundary.
  const planMax = `${todayManila()}T23:59`;

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
      materialsCost: "",
      equipmentCost: String(data.get("equipmentCost") ?? ""),
      otherCost: String(data.get("otherCost") ?? ""),
      // Materials lines (empty rows are dropped); the server sums them into
      // the materials total.
      materials: materials
        .filter(
          (line) =>
            line.name.trim() !== "" ||
            line.amount.trim() !== "" ||
            line.note.trim() !== ""
        )
        .map((line) => ({
          name: line.name.trim(),
          quantity: line.quantity.trim() === "" ? null : Number(line.quantity),
          unit: line.unit.trim(),
          unitPrice:
            line.unitPrice.trim() === "" ? null : Number(line.unitPrice),
          amount: Number(line.amount) || 0,
          note: line.note.trim(),
        })),
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
    for (const line of payload.materials) {
      if (line.name.length < 2 || !(Number(line.amount) >= 0)) {
        setFormError(t.materialsInvalid);
        return;
      }
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
              max={planMax}
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
              max={planMax}
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

        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-ink-muted">
              {t.materialsListTitle}
            </p>
            <p className="mb-2 text-xs text-ink-subtle">
              {t.materialsListDesc}
            </p>
            {suggested && materials.length > 0 && (
              <p className="mb-2 rounded-control border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                {t.materialsSuggested}
              </p>
            )}
            {materials.length === 0 ? (
              <p className="rounded-control border border-dashed border-line-strong bg-surface px-3 py-4 text-center text-sm text-ink-subtle">
                {t.materialsSkipHint}
              </p>
            ) : (
            <div className="space-y-2">
              {materials.map((line) => (
                <div
                  key={line.id}
                  className="grid grid-cols-2 items-start gap-2 sm:grid-cols-[1fr_4.5rem_4.5rem_6rem_6rem_2rem]"
                >
                  <input
                    aria-label={t.materialName}
                    value={line.name}
                    maxLength={160}
                    placeholder={t.materialName}
                    onChange={(event) =>
                      updateMaterial(line.id, "name", event.target.value)
                    }
                    className={inputStyles}
                  />
                  <input
                    aria-label={t.materialQuantity}
                    value={line.quantity}
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder={t.materialQuantity}
                    onChange={(event) =>
                      updateMaterial(line.id, "quantity", event.target.value)
                    }
                    className={inputStyles}
                  />
                  <input
                    aria-label={t.materialUnit}
                    value={line.unit}
                    maxLength={24}
                    placeholder={t.materialUnit}
                    onChange={(event) =>
                      updateMaterial(line.id, "unit", event.target.value)
                    }
                    className={inputStyles}
                  />
                  <input
                    aria-label={t.materialUnitPrice}
                    value={line.unitPrice}
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder={t.materialUnitPrice}
                    onChange={(event) =>
                      updateMaterial(line.id, "unitPrice", event.target.value)
                    }
                    className={inputStyles}
                  />
                  <input
                    aria-label={t.materialAmount}
                    value={line.amount}
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder={t.materialAmount}
                    onChange={(event) =>
                      updateMaterial(line.id, "amount", event.target.value)
                    }
                    className={inputStyles}
                  />
                  <button
                    type="button"
                    onClick={() => removeMaterial(line.id)}
                    className="h-10 rounded-control border border-line-strong bg-surface px-1 text-xs text-ink-subtle hover:text-red-700"
                    aria-label={t.materialRemove}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            )}
            <button
              type="button"
              onClick={addMaterial}
              className="mt-2 text-sm font-medium text-brand-700 hover:text-brand-800"
            >
              + {t.addMaterial}
            </button>
            <p className="mt-2 text-right text-sm">
              <span className="text-ink-subtle">{t.materialsTotal}:</span>{" "}
              <span className="font-semibold tabular-nums text-ink">
                ₱{materialsTotal.toFixed(2)}
              </span>
            </p>
          </div>
        </div>

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
