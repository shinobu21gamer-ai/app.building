"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  FieldError,
  Input,
  Label,
  RequiredLegend,
  FormMessage,
} from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { copy, type Locale } from "@/lib/i18n";
import { CASE_STATUSES } from "@/lib/cases/workflow";
import { SLA_DEFAULT_HOURS } from "@/lib/sla/policy";

export type PolicyFormValues = {
  id?: number;
  key: string;
  name: string;
  stage: string;
  typeId: string;
  priorityLevel: string;
  hours: string;
  escalateToRole: string;
  notifyRoles: string;
  isActive: boolean;
};

const EMPTY: PolicyFormValues = {
  key: "",
  name: "",
  stage: "ASSIGNED",
  typeId: "",
  priorityLevel: "",
  hours: String(SLA_DEFAULT_HOURS),
  escalateToRole: "CAPTAIN",
  notifyRoles: "ADMIN",
  isActive: true,
};

const ROLES = ["CAPTAIN", "ADMIN", "OFFICIAL", "TREASURER"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

/**
 * Creates or edits one SLA policy. The default window is 48 hours; a policy
 * exists precisely to say when a stage should run on something else, and for
 * whom an escalation matters.
 */
export function PolicyForm({
  locale,
  types,
  policy,
  onDone,
}: {
  locale: Locale;
  types: Array<{ id: number; name: string }>;
  /** Present = edit that policy, absent = create a new one. */
  policy?: PolicyFormValues;
  onDone?: () => void;
}) {
  const t = copy[locale].revamp.slaDesk;
  const router = useRouter();
  const [values, setValues] = useState<PolicyFormValues>(policy ?? EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function set<K extends keyof PolicyFormValues>(key: K, value: PolicyFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setDone(false);

    const payload = {
      key: values.key.trim(),
      name: values.name.trim(),
      stage: values.stage,
      typeId: values.typeId === "" ? null : Number(values.typeId),
      priorityLevel: values.priorityLevel === "" ? null : values.priorityLevel,
      hours: Number(values.hours),
      escalateToRole: values.escalateToRole,
      notifyRoles: values.notifyRoles.trim() || null,
      isActive: values.isActive,
    };

    const response = await apiRequest(
      values.id ? `/api/v1/admin/sla/policies/${values.id}` : "/api/v1/admin/sla/policies",
      { method: values.id ? "PATCH" : "POST", body: JSON.stringify(payload) }
    );
    setBusy(false);

    if (!response.success) {
      setError(response.error.message);
      return;
    }
    setDone(true);
    if (!values.id) setValues(EMPTY);
    onDone?.();
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <RequiredLegend>{t.requiredLegend}</RequiredLegend>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="policy-key" required>
            {t.key}
          </Label>
          <Input
            id="policy-key"
            required
            value={values.key}
            placeholder={t.keyPlaceholder}
            onChange={(event) => set("key", event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="policy-name" required>
            {t.name}
          </Label>
          <Input
            id="policy-name"
            required
            value={values.name}
            onChange={(event) => set("name", event.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="policy-stage" required>
            {t.stage}
          </Label>
          <select
            id="policy-stage"
            required
            className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
            value={values.stage}
            onChange={(event) => set("stage", event.target.value)}
          >
            {CASE_STATUSES.map((stage) => (
              <option key={stage} value={stage}>
                {stage.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="policy-hours" required>
            {t.hours}
          </Label>
          <Input
            id="policy-hours"
            required
            type="number"
            min={1}
            max={720}
            value={values.hours}
            onChange={(event) => set("hours", event.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="policy-type">{t.typeScope}</Label>
          <select
            id="policy-type"
            className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
            value={values.typeId}
            onChange={(event) => set("typeId", event.target.value)}
          >
            <option value="">{t.allTypes}</option>
            {types.map((type) => (
              <option key={type.id} value={String(type.id)}>
                {type.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="policy-priority">{t.priorityScope}</Label>
          <select
            id="policy-priority"
            className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
            value={values.priorityLevel}
            onChange={(event) => set("priorityLevel", event.target.value)}
          >
            <option value="">{t.allPriorities}</option>
            {PRIORITIES.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="policy-role" required>
            {t.escalateTo}
          </Label>
          <select
            id="policy-role"
            required
            className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
            value={values.escalateToRole}
            onChange={(event) => set("escalateToRole", event.target.value)}
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="policy-notify">{t.notifyRoles}</Label>
          <Input
            id="policy-notify"
            value={values.notifyRoles}
            placeholder="ADMIN, TREASURER"
            onChange={(event) => set("notifyRoles", event.target.value)}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={values.isActive}
          onChange={(event) => set("isActive", event.target.checked)}
        />
        {t.active}
      </label>

      {error ? <FieldError>{error}</FieldError> : null}
      {done ? <FormMessage tone="success">{t.saved}</FormMessage> : null}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" loading={busy} onClick={submit}>
          {values.id ? t.savePolicy : t.createPolicy}
        </Button>
        {onDone ? (
          <Button size="sm" variant="ghost" onClick={onDone}>
            {copy[locale].revamp.common.cancel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
