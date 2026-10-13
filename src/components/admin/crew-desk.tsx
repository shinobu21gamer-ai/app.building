"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  HardHat,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Save,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { apiRequest } from "@/lib/api-client";
import { extractApiError } from "@/lib/utils";
import {
  CREW_AVAILABILITY,
  CREW_EMPLOYMENT_TYPES,
  CREW_TRADES,
  CREW_TRADE_LABELS,
} from "@/lib/validations/admin";
import { copy, type Locale } from "@/lib/i18n";
// Type-only import: the crew domain module reaches the database, so the shape
// is taken as a type and never bundled into this client component.
import type { CrewDeskRow } from "@/lib/cases/crew";

type OfficeOption = { id: number; name: string; code: string };

type Filter = "all" | "available" | "unprofiled";

type FormState = {
  userId: string;
  trade: string;
  employmentType: string;
  hourlyRate: string;
  dailyRate: string;
  availability: string;
  maxConcurrentCases: string;
  officeId: string;
  notes: string;
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  userId: "",
  trade: "",
  employmentType: "JOB_ORDER",
  hourlyRate: "",
  dailyRate: "",
  availability: "AVAILABLE",
  maxConcurrentCases: "1",
  officeId: "",
  notes: "",
  isActive: true,
};

function formFor(row: CrewDeskRow): FormState {
  return {
    userId: String(row.userId),
    trade: row.trade ?? "",
    employmentType: row.employmentType ?? "JOB_ORDER",
    hourlyRate: row.hourlyRate ?? "",
    dailyRate: row.dailyRate ?? "",
    availability: row.availability ?? "AVAILABLE",
    maxConcurrentCases: String(row.maxConcurrentCases ?? 1),
    officeId: row.officeId ? String(row.officeId) : "",
    notes: row.notes ?? "",
    isActive: row.profileIsActive ?? true,
  };
}

/**
 * The crew roster desk.
 *
 * The roster list and the create/edit form both talk to the same endpoint the
 * crew picker uses (`/api/v1/admin/crew`): the GET with `?scope=desk` lists
 * every crew account — profiled or not, active or disabled — and the POST
 * creates or updates one profile. Enabling and disabling an account is the
 * account's own endpoint, because that switch lives on the user, not on the
 * roster row.
 */
export function CrewDesk({
  crew,
  offices,
  locale = "en",
}: {
  crew: CrewDeskRow[];
  offices: OfficeOption[];
  locale?: Locale;
}) {
  const t = copy[locale].admin.crew;
  const common = copy[locale].revamp.common;
  const router = useRouter();
  const { showToast } = useToast();

  const [rows, setRows] = useState<CrewDeskRow[]>(crew);
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<boolean>(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyUser, setBusyUser] = useState<number | null>(null);

  // The server component already sent the rows; a reload after a save keeps the
  // table honest about caseload counts that other desks may have changed.
  useEffect(() => {
    setRows(crew);
  }, [crew]);

  const reload = useCallback(async () => {
    const result = await apiRequest<{ crew: CrewDeskRow[] }>(
      "/api/v1/admin/crew?scope=desk"
    );
    if (result.success) setRows(result.data.crew);
  }, []);

  function startCreate() {
    setError(null);
    setSuccess(null);
    const unprofiled = rows.find((row) => !row.hasProfile);
    setForm({ ...EMPTY_FORM, userId: unprofiled ? String(unprofiled.userId) : "" });
    setEditing(true);
  }

  function startEdit(row: CrewDeskRow) {
    setError(null);
    setSuccess(null);
    setForm(formFor(row));
    setEditing(true);
  }

  function stopEditing() {
    setEditing(false);
    setForm(EMPTY_FORM);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const userId = Number(form.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      setError(t.personPlaceholder);
      return;
    }
    const hadProfile = rows.find((row) => row.userId === userId)?.hasProfile ?? false;

    setBusy(true);
    const result = await apiRequest("/api/v1/admin/crew", {
      method: "POST",
      body: JSON.stringify({
        userId,
        trade: form.trade || undefined,
        employmentType: form.employmentType,
        hourlyRate: form.hourlyRate === "" ? null : Number(form.hourlyRate),
        dailyRate: form.dailyRate === "" ? null : Number(form.dailyRate),
        availability: form.availability,
        maxConcurrentCases: Number(form.maxConcurrentCases || 1),
        officeId: form.officeId === "" ? null : Number(form.officeId),
        notes: form.notes,
        isActive: form.isActive,
      }),
    });
    setBusy(false);

    if (!result.success) {
      const message = extractApiError(result.error);
      setError(message);
      showToast("error", message);
      return;
    }

    const message = hadProfile ? t.updated : t.created;
    setSuccess(message);
    showToast("success", message);
    stopEditing();
    await reload();
    router.refresh();
  }

  async function toggleAccount(row: CrewDeskRow) {
    setError(null);
    setSuccess(null);
    setBusyUser(row.userId);
    const result = await apiRequest(`/api/v1/admin/users/${row.userId}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: !row.isActive }),
    });
    setBusyUser(null);

    if (!result.success) {
      const message = extractApiError(result.error);
      setError(message);
      showToast("error", message);
      return;
    }

    const message = (row.isActive ? t.accountDisabled : t.accountEnabled).replace(
      "{name}",
      row.name
    );
    setSuccess(message);
    showToast("success", message);
    await reload();
    router.refresh();
  }

  const unprofiled = rows.filter((row) => !row.hasProfile);
  const visible = rows.filter((row) => {
    if (filter === "available") {
      return row.hasProfile && row.profileIsActive === true && row.availability === "AVAILABLE";
    }
    if (filter === "unprofiled") return !row.hasProfile;
    return true;
  });

  const availabilityLabel: Record<string, string> = {
    AVAILABLE: t.availabilityAvailable,
    ON_LEAVE: t.availabilityOnLeave,
    UNAVAILABLE: t.availabilityUnavailable,
  };
  const employmentLabel: Record<string, string> = {
    JOB_ORDER: t.employerJobOrder,
    CASUAL: t.employerCasual,
    PERMANENT: t.employerPermanent,
    VOLUNTEER: t.employerVolunteer,
  };

  function money(value: string | null): string {
    if (value === null) return t.ratesNone;
    const amount = Number(value);
    return Number.isFinite(amount)
      ? `₱${amount.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`
      : value;
  }

  return (
    <div className="space-y-6">
      {success && <FormMessage tone="success">{success}</FormMessage>}
      {error && <FormMessage tone="error">{error}</FormMessage>}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Label htmlFor="crew-filter">{t.filter}</Label>
          <Select
            id="crew-filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value as Filter)}
            className="sm:w-64"
          >
            <option value="all">{t.filterAll}</option>
            <option value="available">{t.filterAvailable}</option>
            <option value="unprofiled">{t.filterUnprofiled}</option>
          </Select>
        </div>
        {!editing && (
          <Button type="button" onClick={startCreate} disabled={unprofiled.length === 0}>
            <Plus size={16} />
            {t.addProfile}
          </Button>
        )}
      </div>

      {unprofiled.length === 0 && !editing && (
        <p className="text-xs text-ink-subtle">{t.noUnprofiled}</p>
      )}

      {editing && (
        <form
          onSubmit={save}
          className="space-y-4 rounded-card border border-line bg-surface-muted p-4"
        >
          <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
            <HardHat size={16} className="text-ink-subtle" />
            {rows.find((row) => String(row.userId) === form.userId)?.hasProfile
              ? t.editProfile
              : t.addProfile}
          </h3>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <Label htmlFor="crew-person">{t.person}</Label>
              <Select
                id="crew-person"
                value={form.userId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, userId: event.target.value }))
                }
                required
              >
                <option value="">{t.personPlaceholder}</option>
                {rows.map((row) => (
                  <option key={row.userId} value={row.userId}>
                    {row.name}
                    {row.hasProfile ? "" : ` · ${t.noProfile}`}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="crew-office">{t.office}</Label>
              <Select
                id="crew-office"
                value={form.officeId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, officeId: event.target.value }))
                }
              >
                <option value="">{t.officeNone}</option>
                {offices.map((office) => (
                  <option key={office.id} value={office.id}>
                    {office.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="crew-trade">{t.trade}</Label>
              <Select
                id="crew-trade"
                value={form.trade}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, trade: event.target.value }))
                }
              >
                <option value="">{t.tradeNone}</option>
                {CREW_TRADES.map((trade) => (
                  <option key={trade} value={trade}>
                    {CREW_TRADE_LABELS[trade]}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="crew-employment">{t.employmentType}</Label>
              <Select
                id="crew-employment"
                value={form.employmentType}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, employmentType: event.target.value }))
                }
              >
                {CREW_EMPLOYMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {employmentLabel[type] ?? type}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="crew-availability">{t.availability}</Label>
              <Select
                id="crew-availability"
                value={form.availability}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, availability: event.target.value }))
                }
              >
                {CREW_AVAILABILITY.map((value) => (
                  <option key={value} value={value}>
                    {availabilityLabel[value] ?? value}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="crew-max">{t.maxCases}</Label>
              <Input
                id="crew-max"
                type="number"
                min={1}
                max={10}
                value={form.maxConcurrentCases}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, maxConcurrentCases: event.target.value }))
                }
              />
              <p className="mt-1 text-xs text-ink-subtle">{t.maxCasesHint}</p>
            </div>

            <div>
              <Label htmlFor="crew-hourly">{t.hourlyRate}</Label>
              <Input
                id="crew-hourly"
                type="number"
                min={0}
                step="0.01"
                value={form.hourlyRate}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, hourlyRate: event.target.value }))
                }
              />
            </div>

            <div>
              <Label htmlFor="crew-daily">{t.dailyRate}</Label>
              <Input
                id="crew-daily"
                type="number"
                min={0}
                step="0.01"
                value={form.dailyRate}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, dailyRate: event.target.value }))
                }
              />
              <p className="mt-1 text-xs text-ink-subtle">{t.ratesHint}</p>
            </div>

            <div className="sm:col-span-2 lg:col-span-1">
              <Label htmlFor="crew-notes">{t.notes}</Label>
              <Textarea
                id="crew-notes"
                rows={2}
                maxLength={500}
                value={form.notes}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, notes: event.target.value }))
                }
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, isActive: event.target.checked }))
              }
              className="h-4 w-4 rounded border-line-strong"
            />
            {t.onRoster}
          </label>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              <Save size={16} />
              {busy ? t.saving : t.save}
            </Button>
            <Button type="button" variant="outline" onClick={stopEditing}>
              <X size={16} />
              {common.cancel}
            </Button>
          </div>
        </form>
      )}

      <div>
        <h2 className="mb-3 text-base font-semibold text-ink">
          {t.listTitle.replace("{count}", String(visible.length))}
        </h2>

        {visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-muted">{t.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <caption className="sr-only">
                {t.listTitle.replace("{count}", String(visible.length))}
              </caption>
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-subtle">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.colPerson}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.colOffice}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.colTrade}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.colRates}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.colAvailability}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.colCases}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.colRoster}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.colStatus}
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    <span className="sr-only">{common.actions}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map((row) => (
                  <tr key={row.userId} className="hover:bg-surface-muted">
                    <td className="py-3 pr-4">
                      <span className="font-medium text-ink">{row.name}</span>
                      <span className="block text-xs text-ink-subtle">{row.email}</span>
                    </td>
                    <td className="py-3 pr-4 text-ink-muted">
                      {row.officeName ?? "—"}
                    </td>
                    <td className="py-3 pr-4 text-ink-muted">
                      {row.trade ? CREW_TRADE_LABELS[row.trade as keyof typeof CREW_TRADE_LABELS] ?? row.trade : "—"}
                      {row.employmentType ? (
                        <span className="block text-xs text-ink-subtle">
                          {employmentLabel[row.employmentType] ?? row.employmentType}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4 text-ink-muted">
                      {row.hourlyRate ? (
                        <span className="block">
                          {t.ratesHourly.replace("{amount}", money(row.hourlyRate))}
                        </span>
                      ) : null}
                      {row.dailyRate ? (
                        <span className="block">
                          {t.ratesDaily.replace("{amount}", money(row.dailyRate))}
                        </span>
                      ) : null}
                      {!row.hourlyRate && !row.dailyRate && t.ratesNone}
                    </td>
                    <td className="py-3 pr-4">
                      {row.hasProfile ? (
                        <Badge
                          tone={row.availability === "AVAILABLE" ? "green" : "amber"}
                        >
                          {availabilityLabel[row.availability ?? ""] ?? row.availability}
                        </Badge>
                      ) : (
                        <span className="text-xs text-ink-subtle">{t.noProfile}</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-ink-muted">
                      {t.openCases.replace("{count}", String(row.openAssignments))}
                      {row.maxConcurrentCases ? (
                        <span className="block text-xs text-ink-subtle">
                          {t.maxCases}: {row.maxConcurrentCases}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4">
                      {row.profileIsActive === true ? (
                        <Badge tone="sky">{t.profileRow}</Badge>
                      ) : (
                        <Badge tone="gray">{t.noProfile}</Badge>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {row.isActive ? (
                        <Badge tone="green">{t.activeAccount}</Badge>
                      ) : (
                        <Badge tone="gray">{t.disabledAccount}</Badge>
                      )}
                    </td>
                    <td className="py-3">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => startEdit(row)}
                          className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-800"
                        >
                          <Pencil size={14} />
                          {row.hasProfile ? common.edit : t.addProfile}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleAccount(row)}
                          disabled={busyUser === row.userId}
                          className="inline-flex items-center gap-1 text-sm font-semibold text-ink-muted hover:text-ink disabled:opacity-40"
                        >
                          {row.isActive ? (
                            <>
                              <PowerOff size={14} /> {t.disableAccount}
                            </>
                          ) : (
                            <>
                              <Power size={14} /> {t.enableAccount}
                            </>
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
