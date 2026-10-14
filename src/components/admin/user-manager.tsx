"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Save,
  Plus,
  Pencil,
  X,
  Trash2,
  Power,
  PowerOff,
  Key,
  AlertCircle,
  CheckCircle2,
  User,
  Mail,
  Phone,
  MapPin,
  Lock,
  Shield,
  Building2,
  HardHat,
  ToggleLeft,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label, RequiredLegend, Select, Textarea } from "@/components/ui/field";
import { ConfirmActionButton } from "@/components/ui/confirm-action-button";
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
type RoleOption = { id: number; key: string; name: string };
type OfficeOption = { id: number; name: string; code: string };

export type AdminUserItem = {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  /** Masked for display — staff never receive the full number. */
  phone: string | null;
  phoneLast4?: string | null;
  hasPhone?: boolean;
  address: string | null;
  position?: string | null;
  isActive: boolean;
  createdAt: string;
  role: RoleOption;
  office: OfficeOption | null;
  references: {
    concerns: number;
    resolutions: number;
    history: number;
    audits: number;
    assignments: number;
    total: number;
  };
};

const selectStyles =
  "h-10 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

type TouchedFields = {
  firstName: boolean;
  lastName: boolean;
  email: boolean;
  password: boolean;
};

const initialTouched: TouchedFields = {
  firstName: false,
  lastName: false,
  email: false,
  password: false,
};

export function UserManager({
  users,
  roles,
  offices,
  fixedRole,
  currentUserId,
  locale = "en",
}: {
  users: AdminUserItem[];
  roles: RoleOption[];
  offices: OfficeOption[];
  fixedRole?: "OFFICIAL";
  currentUserId: number;
  locale?: Locale;
}) {
  const t = copy[locale].admin.mgr;
  const crewCopy = copy[locale].admin.crew;
  const router = useRouter();
  const { showToast } = useToast();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [additionalOffices, setAdditionalOffices] = useState<OfficeOption[]>([]);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  // Masked value of the number already on file, shown as a hint only.
  const [storedPhoneMask, setStoredPhoneMask] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [roleKey, setRoleKey] = useState(fixedRole ?? roles[0]?.key ?? "RESIDENT");
  const [officeId, setOfficeId] = useState(
    offices[0] ? String(offices[0].id) : ""
  );
  const [isActive, setIsActive] = useState(true);
  // Crew profile fields, shown when the role is Maintenance Crew. They travel
  // with the account so a new crew member arrives profiled and assignable.
  const [crewTrade, setCrewTrade] = useState("");
  const [crewEmploymentType, setCrewEmploymentType] = useState("JOB_ORDER");
  const [crewHourlyRate, setCrewHourlyRate] = useState("");
  const [crewDailyRate, setCrewDailyRate] = useState("");
  const [crewAvailability, setCrewAvailability] = useState("AVAILABLE");
  const [crewMaxCases, setCrewMaxCases] = useState("1");
  const [crewNotes, setCrewNotes] = useState("");
  const [crewRosterActive, setCrewRosterActive] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState<TouchedFields>(initialTouched);
  const [resetResult, setResetResult] = useState<{
    name: string;
    code: string;
    expiresInMinutes: number;
  } | null>(null);

  // Officials must belong to an office; crew may, and the roster desk uses the
  // crew profile's office to offer them the right cases first.
  const showOffice = roleKey === "OFFICIAL" || roleKey === "CREW";
  const showCrewFields = roleKey === "CREW";
  const officeOptions = [...additionalOffices, ...offices];

  // Crew labels: the same wording the crew roster screen uses, so a trade or an
  // availability reads identically wherever it is set.
  const availabilityLabel: Record<string, string> = {
    AVAILABLE: crewCopy.availabilityAvailable,
    ON_LEAVE: crewCopy.availabilityOnLeave,
    UNAVAILABLE: crewCopy.availabilityUnavailable,
  };
  const employmentLabel: Record<string, string> = {
    JOB_ORDER: crewCopy.employerJobOrder,
    CASUAL: crewCopy.employerCasual,
    PERMANENT: crewCopy.employerPermanent,
    VOLUNTEER: crewCopy.employerVolunteer,
  };

  // Validation helpers
  function isFirstNameInvalid() {
    return touched.firstName && firstName.trim().length === 0;
  }
  function isLastNameInvalid() {
    return touched.lastName && lastName.trim().length === 0;
  }
  function isEmailInvalid() {
    return (
      touched.email &&
      (email.trim().length === 0 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    );
  }
  function isPasswordInvalid() {
    if (editingId && password.trim().length === 0) return false;
    return touched.password && password.trim().length > 0 && password.trim().length < 8;
  }
  function isFieldValid(field: keyof TouchedFields) {
    switch (field) {
      case "firstName":
        return touched.firstName && firstName.trim().length > 0;
      case "lastName":
        return touched.lastName && lastName.trim().length > 0;
      case "email":
        return (
          touched.email &&
          email.trim().length > 0 &&
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
        );
      case "password":
        if (editingId && password.trim().length === 0) return false;
        return touched.password && password.trim().length >= 8;
      default:
        return false;
    }
  }

  function resetForm() {
    setEditingId(null);
    setAdditionalOffices([]);
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setAddress("");
    setPassword("");
    setRoleKey(fixedRole ?? roles[0]?.key ?? "RESIDENT");
    setOfficeId(offices[0] ? String(offices[0].id) : "");
    setIsActive(true);
    setCrewTrade("");
    setCrewEmploymentType("JOB_ORDER");
    setCrewHourlyRate("");
    setCrewDailyRate("");
    setCrewAvailability("AVAILABLE");
    setCrewMaxCases("1");
    setCrewNotes("");
    setCrewRosterActive(true);
    setTouched(initialTouched);
  }

  function startEdit(user: AdminUserItem) {
    setEditingId(user.id);
    setAdditionalOffices(
      user.office && !offices.some((office) => office.id === user.office!.id)
        ? [user.office]
        : []
    );
    setFirstName(user.firstName);
    setLastName(user.lastName);
    setEmail(user.email);
    // The stored number is only ever shown masked, so the input starts empty:
    // an untouched field must never write a masked string back to the server.
    setPhone("");
    setStoredPhoneMask(user.hasPhone ? (user.phone ?? null) : null);
    setAddress(user.address ?? "");
    setPassword("");
    setRoleKey(user.role.key);
    setOfficeId(user.office ? String(user.office.id) : "");
    setIsActive(user.isActive);
    setError(null);
    setSuccess(null);
    setTouched(initialTouched);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    // Mark all required fields as touched
    setTouched({
      firstName: true,
      lastName: true,
      email: true,
      password: true,
    });

    if (showOffice && !officeId) {
      setError(t.selectOfficeError);
      showToast("error", t.selectOfficeError);
      return;
    }
    if (!editingId && password.trim().length < 8) {
      setError(t.passwordCreateError);
      showToast("error", t.passwordCreateError);
      return;
    }
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      const missing = [];
      if (!firstName.trim()) missing.push(t.firstName);
      if (!lastName.trim()) missing.push(t.lastName);
      if (!email.trim()) missing.push(t.email);
      const msg = t.fillIn.replace("{fields}", missing.join(", "));
      setError(msg);
      showToast("error", msg);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError(t.emailInvalid);
      showToast("error", t.emailInvalid);
      return;
    }

    const payload: Record<string, unknown> = {
      firstName,
      lastName,
      email,
      address,
      roleKey,
      officeId: showOffice && officeId ? Number(officeId) : null,
      isActive,
    };
    // Only send a phone number when one was typed: the server encrypts it and
    // an empty field must leave the stored number untouched.
    if (phone.trim() !== "") payload.phone = phone.trim();
    if (password.trim()) payload.password = password;
    // A new crew account is sent with its roster profile. On an existing
    // account the profile is edited on the crew roster screen instead, so the
    // dialog never overwrites a trade or a rate that the roster desk set.
    if (showCrewFields && !editingId) {
      payload.crew = {
        trade: crewTrade || undefined,
        employmentType: crewEmploymentType,
        hourlyRate: crewHourlyRate === "" ? null : Number(crewHourlyRate),
        dailyRate: crewDailyRate === "" ? null : Number(crewDailyRate),
        availability: crewAvailability,
        maxConcurrentCases: Number(crewMaxCases || 1),
        officeId: officeId ? Number(officeId) : null,
        notes: crewNotes || undefined,
        isActive: crewRosterActive,
      };
    }

    setBusy(true);
    const result = editingId
      ? await apiRequest<{ user: AdminUserItem }>(
          `/api/v1/admin/users/${editingId}`,
          { method: "PATCH", body: JSON.stringify(payload) }
        )
      : await apiRequest<{ user: AdminUserItem }>("/api/v1/admin/users", {
          method: "POST",
          body: JSON.stringify(payload),
        });
    setBusy(false);

    if (!result.success) {
      const errorMsg = extractApiError(result.error);
      setError(errorMsg);
      showToast("error", errorMsg);
      return;
    }

    const successMsg = editingId ? t.accountUpdated : t.accountCreated;
    setSuccess(successMsg);
    showToast("success", successMsg);
    resetForm();
    router.refresh();
  }

  async function toggleActive(user: AdminUserItem) {
    setError(null);
    setSuccess(null);
    setBusy(true);
    const result = await apiRequest<{ user: AdminUserItem }>(
      `/api/v1/admin/users/${user.id}`,
      { method: "PATCH", body: JSON.stringify({ isActive: !user.isActive }) }
    );
    setBusy(false);

    if (!result.success) {
      const errorMsg = extractApiError(result.error);
      setError(errorMsg);
      showToast("error", errorMsg);
      return;
    }
    const msg = (user.isActive ? t.userDisabled : t.userEnabled).replace(
      "{name}",
      `${user.firstName} ${user.lastName}`
    );
    setSuccess(msg);
    showToast("success", msg);
    router.refresh();
  }

  async function deleteUser(user: AdminUserItem): Promise<string | null> {
    setError(null);
    setSuccess(null);
    const result = await apiRequest<{ deleted: boolean }>(
      `/api/v1/admin/users/${user.id}`,
      { method: "DELETE" }
    );
    if (!result.success) return extractApiError(result.error);
    const msg = t.deletedUnused.replace("{email}", user.email);
    setSuccess(msg);
    showToast("success", msg);
    router.refresh();
    return null;
  }

  async function resetPassword(user: AdminUserItem): Promise<string | null> {
    setError(null);
    setSuccess(null);
    const result = await apiRequest<{ code: string; expiresInMinutes: number }>(
      `/api/v1/admin/users/${user.id}/reset-password`,
      { method: "POST" }
    );
    if (!result.success) return extractApiError(result.error);
    setResetResult({
      name: `${user.firstName} ${user.lastName}`,
      code: result.data.code,
      expiresInMinutes: result.data.expiresInMinutes,
    });
    showToast(
      "success",
      t.resetGenerated.replace("{name}", `${user.firstName} ${user.lastName}`)
    );
    return null;
  }

  useEffect(() => {
    if (!resetResult) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setResetResult(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [resetResult]);

  return (
    <div className="space-y-8">
      {success && <FormMessage tone="success">{success}</FormMessage>}
      {error && <FormMessage tone="error">{error}</FormMessage>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <RequiredLegend>{copy[locale].register.requiredLegend}</RequiredLegend>
        <h2 className="inline-flex items-center gap-2 text-base font-semibold text-ink">
          {editingId ? (
            <>
              <Pencil size={16} className="text-ink-subtle" />
              {t.editAccount}
            </>
          ) : fixedRole === "OFFICIAL" ? (
            <>
              <Shield size={16} className="text-ink-subtle" />
              {t.addOfficial}
            </>
          ) : (
            <>
              <Plus size={16} className="text-ink-subtle" />
              {t.addAccount}
            </>
          )}
        </h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="user-first" required>
              <span className="inline-flex items-center gap-1.5">
                <User size={14} className="text-ink-subtle" />
                {t.firstName}
              </span>
            </Label>
            <div className="relative">
              <Input
                id="user-first"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                onBlur={() => setTouched((p) => ({ ...p, firstName: true }))}
                required
                invalid={isFirstNameInvalid()}
                className="pr-9"
              />
              {touched.firstName && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2">
                  {isFirstNameInvalid() ? (
                    <AlertCircle size={16} className="text-red-500" />
                  ) : isFieldValid("firstName") ? (
                    <CheckCircle2 size={16} className="text-emerald-500" />
                  ) : null}
                </span>
              )}
            </div>
            {isFirstNameInvalid() && (
              <p className="mt-1 text-xs text-red-600">{t.firstRequired}</p>
            )}
          </div>
          <div>
            <Label htmlFor="user-last" required>
              <span className="inline-flex items-center gap-1.5">
                <User size={14} className="text-ink-subtle" />
                {t.lastName}
              </span>
            </Label>
            <div className="relative">
              <Input
                id="user-last"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                onBlur={() => setTouched((p) => ({ ...p, lastName: true }))}
                required
                invalid={isLastNameInvalid()}
                className="pr-9"
              />
              {touched.lastName && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2">
                  {isLastNameInvalid() ? (
                    <AlertCircle size={16} className="text-red-500" />
                  ) : isFieldValid("lastName") ? (
                    <CheckCircle2 size={16} className="text-emerald-500" />
                  ) : null}
                </span>
              )}
            </div>
            {isLastNameInvalid() && (
              <p className="mt-1 text-xs text-red-600">{t.lastRequired}</p>
            )}
          </div>
          <div>
            <Label htmlFor="user-email" required>
              <span className="inline-flex items-center gap-1.5">
                <Mail size={14} className="text-ink-subtle" />
                {t.email}
              </span>
            </Label>
            <div className="relative">
              <Input
                id="user-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onBlur={() => setTouched((p) => ({ ...p, email: true }))}
                required
                invalid={isEmailInvalid()}
                className="pr-9"
              />
              {touched.email && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2">
                  {isEmailInvalid() ? (
                    <AlertCircle size={16} className="text-red-500" />
                  ) : isFieldValid("email") ? (
                    <CheckCircle2 size={16} className="text-emerald-500" />
                  ) : null}
                </span>
              )}
            </div>
            {isEmailInvalid() && (
              <p className="mt-1 text-xs text-red-600">
                {email.trim().length === 0 ? t.emailRequired : t.emailInvalid}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="user-phone">
              <span className="inline-flex items-center gap-1.5">
                <Phone size={14} className="text-ink-subtle" />
                {t.phone}
              </span>
            </Label>
            <Input
              id="user-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder={storedPhoneMask ?? t.optional}
              inputMode="tel"
            />
            {storedPhoneMask && phone.trim() === "" && (
              <p className="mt-1 text-xs text-ink-subtle">
                {t.phoneUnchanged.replace("{phone}", storedPhoneMask)}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="user-password" required={!editingId}>
              <span className="inline-flex items-center gap-1.5">
                <Lock size={14} className="text-ink-subtle" />
                {t.password} {editingId ? t.passwordKeep : ""}
              </span>
            </Label>
            <div className="relative">
              <Input
                id="user-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onBlur={() => setTouched((p) => ({ ...p, password: true }))}
                placeholder={editingId ? t.passwordUnchanged : t.passwordPlaceholder}
                autoComplete="new-password"
                required={!editingId}
                invalid={isPasswordInvalid()}
                className="pr-9"
              />
              {touched.password && password.trim().length > 0 && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2">
                  {isPasswordInvalid() ? (
                    <AlertCircle size={16} className="text-red-500" />
                  ) : isFieldValid("password") ? (
                    <CheckCircle2 size={16} className="text-emerald-500" />
                  ) : null}
                </span>
              )}
            </div>
            {isPasswordInvalid() && (
              <p className="mt-1 text-xs text-red-600">
                {t.passwordMin}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="user-address">
              <span className="inline-flex items-center gap-1.5">
                <MapPin size={14} className="text-ink-subtle" />
                {t.address}
              </span>
            </Label>
            <Input
              id="user-address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder={t.optional}
            />
          </div>

          {fixedRole ? null : (
            <div>
              <Label htmlFor="user-role" required>
                <span className="inline-flex items-center gap-1.5">
                  <Shield size={14} className="text-ink-subtle" />
                  {t.role}
                </span>
              </Label>
              <select
                id="user-role"
                value={roleKey}
                onChange={(event) => setRoleKey(event.target.value)}
                className={selectStyles}
              >
                {roles.map((role) => (
                  <option key={role.id} value={role.key}>
                    {role.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {showOffice && (
            <div>
              <Label htmlFor="user-office" required={roleKey === "OFFICIAL"}>
                <span className="inline-flex items-center gap-1.5">
                  <Building2 size={14} className="text-ink-subtle" />
                  {t.office}
                </span>
              </Label>
              <select
                id="user-office"
                required={roleKey === "OFFICIAL"}
                value={officeId}
                onChange={(event) => setOfficeId(event.target.value)}
                className={selectStyles}
              >
                <option value="">{t.selectOffice}</option>
                {officeOptions.map((office) => (
                  <option key={office.id} value={office.id}>
                    {office.name}
                  </option>
                ))}
              </select>
              {roleKey === "CREW" && (
                <p className="mt-1 text-xs text-ink-subtle">{crewCopy.officeHint}</p>
              )}
            </div>
          )}
        </div>

        {showCrewFields && !editingId && (
          <fieldset className="space-y-3 rounded-card border border-line bg-surface-muted p-4">
            <legend className="px-1 text-sm font-semibold text-ink">
              <span className="inline-flex items-center gap-1.5">
                <HardHat size={14} className="text-ink-subtle" />
                {crewCopy.sectionTitle}
              </span>
            </legend>
            <p className="text-xs text-ink-subtle">{crewCopy.sectionHint}</p>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="crew-trade">{crewCopy.trade}</Label>
                <Select
                  id="crew-trade"
                  value={crewTrade}
                  onChange={(event) => setCrewTrade(event.target.value)}
                >
                  <option value="">{crewCopy.tradeNone}</option>
                  {CREW_TRADES.map((trade) => (
                    <option key={trade} value={trade}>
                      {CREW_TRADE_LABELS[trade]}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="crew-employment">{crewCopy.employmentType}</Label>
                <Select
                  id="crew-employment"
                  value={crewEmploymentType}
                  onChange={(event) => setCrewEmploymentType(event.target.value)}
                >
                  {CREW_EMPLOYMENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {employmentLabel[type]}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="crew-availability">{crewCopy.availability}</Label>
                <Select
                  id="crew-availability"
                  value={crewAvailability}
                  onChange={(event) => setCrewAvailability(event.target.value)}
                >
                  {CREW_AVAILABILITY.map((value) => (
                    <option key={value} value={value}>
                      {availabilityLabel[value]}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="crew-hourly">{crewCopy.hourlyRate}</Label>
                <Input
                  id="crew-hourly"
                  type="number"
                  min={0}
                  step="0.01"
                  value={crewHourlyRate}
                  onChange={(event) => setCrewHourlyRate(event.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="crew-daily">{crewCopy.dailyRate}</Label>
                <Input
                  id="crew-daily"
                  type="number"
                  min={0}
                  step="0.01"
                  value={crewDailyRate}
                  onChange={(event) => setCrewDailyRate(event.target.value)}
                />
                <p className="mt-1 text-xs text-ink-subtle">{crewCopy.ratesHint}</p>
              </div>

              <div>
                <Label htmlFor="crew-max" required>{crewCopy.maxCases}</Label>
                <Input
                  id="crew-max"
                  type="number"
                  min={1}
                  max={10}
                  value={crewMaxCases}
                  onChange={(event) => setCrewMaxCases(event.target.value)}
                />
                <p className="mt-1 text-xs text-ink-subtle">{crewCopy.maxCasesHint}</p>
              </div>

              <div className="sm:col-span-2 lg:col-span-3">
                <Label htmlFor="crew-notes">{crewCopy.notes}</Label>
                <Textarea
                  id="crew-notes"
                  rows={2}
                  maxLength={500}
                  value={crewNotes}
                  onChange={(event) => setCrewNotes(event.target.value)}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-ink-muted">
              <input
                type="checkbox"
                checked={crewRosterActive}
                onChange={(event) => setCrewRosterActive(event.target.checked)}
                className="h-4 w-4 rounded border-line-strong"
              />
              {crewCopy.onRoster}
            </label>
          </fieldset>
        )}

        {showCrewFields && editingId && (
          <p className="rounded-control border border-line bg-surface-sunken px-3 py-2 text-xs leading-relaxed text-ink-muted">
            {crewCopy.editHint}{" "}
            <a href="/admin/crew" className="font-semibold text-brand-700 underline">
              {crewCopy.editLink}
            </a>
          </p>
        )}

        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
            className="h-4 w-4 rounded border-line-strong"
          />
          <ToggleLeft size={14} className="text-ink-subtle" />
          {t.accountActive}
        </label>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                {t.saving}
              </>
            ) : editingId ? (
              <>
                <Save size={16} />
                {t.saveChanges}
              </>
            ) : (
              <>
                <Plus size={16} />
                {t.createAccount}
              </>
            )}
          </Button>
          {editingId && (
            <Button type="button" variant="outline" onClick={resetForm}>
              <X size={16} />
              {t.cancelEdit}
            </Button>
          )}
        </div>
      </form>

      <div>
        <h2 className="mb-3 text-base font-semibold text-ink">
          {(fixedRole === "OFFICIAL" ? t.officialsList : t.accountsList).replace(
            "{count}",
            String(users.length)
          )}
        </h2>
        {users.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-muted">
            {t.noAccounts}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <caption className="sr-only">
                {fixedRole === "OFFICIAL" ? t.officialsList.replace("{count}", String(users.length)) : t.accountsList.replace("{count}", String(users.length))}
              </caption>
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-subtle">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.colName}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.colEmail}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.colRole}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.colOffice}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.colRecords}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.colStatus}
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {users.map((user) => {
                  const isSelf = user.id === currentUserId;
                  return (
                    <tr key={user.id} className="hover:bg-surface-muted">
                      <td className="py-3 pr-4 font-medium text-ink">
                        {user.firstName} {user.lastName}
                        {isSelf && (
                          <span className="ml-2 text-xs text-ink-subtle">
                            {t.you}
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-ink-muted">{user.email}</td>
                      <td className="py-3 pr-4 text-ink-muted">
                        {user.role.name}
                      </td>
                      <td className="py-3 pr-4 text-ink-muted">
                        {user.office ? user.office.name : "—"}
                      </td>
                      <td className="py-3 pr-4 text-ink-muted">
                        {user.references.total}
                      </td>
                      <td className="py-3 pr-4">
                        {user.isActive ? (
                          <Badge tone="green">{t.active}</Badge>
                        ) : (
                          <Badge tone="gray">{t.disabled}</Badge>
                        )}
                      </td>
                      <td className="py-3">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            type="button"
                            onClick={() => startEdit(user)}
                            className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-800"
                          >
                            <Pencil size={14} />
                            {t.edit}
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleActive(user)}
                            disabled={busy || isSelf}
                            className="inline-flex items-center gap-1 text-sm font-semibold text-ink-muted hover:text-ink disabled:opacity-40"
                          >
                            {user.isActive ? (
                              <><PowerOff size={14} /> {t.disable}</>
                            ) : (
                              <><Power size={14} /> {t.enable}</>
                            )}
                          </button>
                          <ConfirmActionButton
                            label={t.delete}
                            icon={<Trash2 size={14} />}
                            title={t.deleteUserTitle.replace(
                              "{name}",
                              `${user.firstName} ${user.lastName}`
                            )}
                            description={
                              user.references.total > 0
                                ? t.deleteUserLinked.replace(
                                    "{count}",
                                    String(user.references.total)
                                  )
                                : t.deleteUserEmpty
                            }
                            confirmLabel={t.deleteAccount}
                            tone="danger"
                            disabled={isSelf}
                            cancelLabel={t.cancelAction}
                            busyLabel={t.workingEllipsis}
                            onConfirm={() => deleteUser(user)}
                          />
                          {!isSelf && (
                            <ConfirmActionButton
                              label={t.resetPassword}
                              icon={<Key size={14} />}
                              title={t.resetTitle.replace(
                                "{name}",
                                `${user.firstName} ${user.lastName}`
                              )}
                              description={t.resetDesc}
                              confirmLabel={t.generateCode}
                              disabled={busy}
                              className="inline-flex items-center gap-1 text-sm font-semibold text-ink-muted hover:text-ink disabled:opacity-40"
                              cancelLabel={t.cancelAction}
                              busyLabel={t.workingEllipsis}
                              onConfirm={() => resetPassword(user)}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    {resetResult && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-code-title"
        >
          <div className="w-full max-w-md rounded-card bg-surface p-5 shadow-xl">
            <h2
              id="reset-code-title"
              className="inline-flex items-center gap-2 text-base font-semibold text-ink"
            >
              <Key size={16} className="text-ink-subtle" />
              {t.resetCodeTitle.replace("{name}", resetResult.name)}
            </h2>
            <p className="mt-2 text-sm text-ink-muted">
              {t.resetCodeBody.replace(
                "{minutes}",
                String(resetResult.expiresInMinutes)
              )}
            </p>
            <div className="mt-4 rounded-control border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="break-all text-center font-mono text-lg font-bold tracking-widest text-ink">
                {resetResult.code}
              </p>
            </div>
            <Button
              type="button"
              onClick={() => setResetResult(null)}
              className="mt-5 w-full"
            >
              <CheckCircle2 size={16} />
              {t.gotIt}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
