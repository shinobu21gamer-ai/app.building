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
  ToggleLeft,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label } from "@/components/ui/field";
import { ConfirmActionButton } from "@/components/ui/confirm-action-button";
import { useToast } from "@/components/ui/toast";
import { apiRequest } from "@/lib/api-client";
import { extractApiError } from "@/lib/utils";
type RoleOption = { id: number; key: string; name: string };
type OfficeOption = { id: number; name: string; code: string };

export type AdminUserItem = {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  address: string | null;
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
  "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

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
}: {
  users: AdminUserItem[];
  roles: RoleOption[];
  offices: OfficeOption[];
  fixedRole?: "OFFICIAL";
  currentUserId: number;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [additionalOffices, setAdditionalOffices] = useState<OfficeOption[]>([]);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [roleKey, setRoleKey] = useState(fixedRole ?? roles[0]?.key ?? "RESIDENT");
  const [officeId, setOfficeId] = useState(
    offices[0] ? String(offices[0].id) : ""
  );
  const [isActive, setIsActive] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState<TouchedFields>(initialTouched);
  const [resetResult, setResetResult] = useState<{
    name: string;
    code: string;
    expiresInMinutes: number;
  } | null>(null);

  const showOffice = roleKey === "OFFICIAL";
  const officeOptions = [...additionalOffices, ...offices];

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
    setPhone(user.phone ?? "");
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
      setError("Select an office for this official.");
      showToast("error", "Select an office for this official.");
      return;
    }
    if (!editingId && password.trim().length < 8) {
      setError("Set a password of at least 8 characters.");
      showToast("error", "Set a password of at least 8 characters.");
      return;
    }
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      const missing = [];
      if (!firstName.trim()) missing.push("First name");
      if (!lastName.trim()) missing.push("Last name");
      if (!email.trim()) missing.push("Email");
      setError(`Please fill in: ${missing.join(", ")}.`);
      showToast("error", `Please fill in: ${missing.join(", ")}.`);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Please enter a valid email address.");
      showToast("error", "Please enter a valid email address.");
      return;
    }

    const payload: Record<string, unknown> = {
      firstName,
      lastName,
      email,
      phone,
      address,
      roleKey,
      officeId: showOffice && officeId ? Number(officeId) : null,
      isActive,
    };
    if (password.trim()) payload.password = password;

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

    const successMsg = editingId
      ? "Account updated successfully."
      : "Account created successfully!";
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
    const msg = `${user.firstName} ${user.lastName} ${
      user.isActive ? "disabled" : "enabled"
    }.`;
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
    const msg = `Deleted unused account ${user.email}.`;
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
    showToast("success", `Reset code generated for ${user.firstName} ${user.lastName}.`);
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
        <h2 className="inline-flex items-center gap-2 text-base font-semibold text-slate-900">
          {editingId ? (
            <>
              <Pencil size={16} className="text-slate-500" />
              Edit account
            </>
          ) : fixedRole === "OFFICIAL" ? (
            <>
              <Shield size={16} className="text-slate-500" />
              Add official
            </>
          ) : (
            <>
              <Plus size={16} className="text-slate-500" />
              Add account
            </>
          )}
        </h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="user-first">
              <span className="inline-flex items-center gap-1.5">
                <User size={14} className="text-slate-500" />
                First name
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
              <p className="mt-1 text-xs text-red-600">First name is required.</p>
            )}
          </div>
          <div>
            <Label htmlFor="user-last">
              <span className="inline-flex items-center gap-1.5">
                <User size={14} className="text-slate-500" />
                Last name
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
              <p className="mt-1 text-xs text-red-600">Last name is required.</p>
            )}
          </div>
          <div>
            <Label htmlFor="user-email">
              <span className="inline-flex items-center gap-1.5">
                <Mail size={14} className="text-slate-500" />
                Email
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
                {email.trim().length === 0
                  ? "Email is required."
                  : "Please enter a valid email address."}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="user-phone">
              <span className="inline-flex items-center gap-1.5">
                <Phone size={14} className="text-slate-500" />
                Phone
              </span>
            </Label>
            <Input
              id="user-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="Optional"
            />
          </div>
          <div>
            <Label htmlFor="user-password">
              <span className="inline-flex items-center gap-1.5">
                <Lock size={14} className="text-slate-500" />
                Password {editingId ? "(leave blank to keep)" : ""}
              </span>
            </Label>
            <div className="relative">
              <Input
                id="user-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onBlur={() => setTouched((p) => ({ ...p, password: true }))}
                placeholder={editingId ? "Unchanged" : "At least 8 characters"}
                autoComplete="new-password"
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
                Password must be at least 8 characters.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="user-address">
              <span className="inline-flex items-center gap-1.5">
                <MapPin size={14} className="text-slate-500" />
                Address
              </span>
            </Label>
            <Input
              id="user-address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Optional"
            />
          </div>

          {fixedRole ? null : (
            <div>
              <Label htmlFor="user-role">
                <span className="inline-flex items-center gap-1.5">
                  <Shield size={14} className="text-slate-500" />
                  Role
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
              <Label htmlFor="user-office">
                <span className="inline-flex items-center gap-1.5">
                  <Building2 size={14} className="text-slate-500" />
                  Office
                </span>
              </Label>
              <select
                id="user-office"
                value={officeId}
                onChange={(event) => setOfficeId(event.target.value)}
                className={selectStyles}
              >
                <option value="">Select an office</option>
                {officeOptions.map((office) => (
                  <option key={office.id} value={office.id}>
                    {office.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          <ToggleLeft size={14} className="text-slate-500" />
          Account active (can sign in)
        </label>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Saving...
              </>
            ) : editingId ? (
              <>
                <Save size={16} />
                Save changes
              </>
            ) : (
              <>
                <Plus size={16} />
                Create account
              </>
            )}
          </Button>
          {editingId && (
            <Button type="button" variant="outline" onClick={resetForm}>
              <X size={16} />
              Cancel edit
            </Button>
          )}
        </div>
      </form>

      <div>
        <h2 className="mb-3 text-base font-semibold text-slate-900">
          {fixedRole === "OFFICIAL" ? "Officials" : "Accounts"} ({users.length})
        </h2>
        {users.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-600">
            No accounts match the current filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <caption className="sr-only">
                {fixedRole === "OFFICIAL" ? "Barangay officials" : "User accounts"}
              </caption>
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Name
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Email
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Role
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Office
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Records
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Status
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((user) => {
                  const isSelf = user.id === currentUserId;
                  return (
                    <tr key={user.id} className="hover:bg-slate-50">
                      <td className="py-3 pr-4 font-medium text-slate-900">
                        {user.firstName} {user.lastName}
                        {isSelf && (
                          <span className="ml-2 text-xs text-slate-500">
                            (you)
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-slate-600">{user.email}</td>
                      <td className="py-3 pr-4 text-slate-600">
                        {user.role.name}
                      </td>
                      <td className="py-3 pr-4 text-slate-600">
                        {user.office ? user.office.name : "—"}
                      </td>
                      <td className="py-3 pr-4 text-slate-600">
                        {user.references.total}
                      </td>
                      <td className="py-3 pr-4">
                        {user.isActive ? (
                          <Badge tone="green">Active</Badge>
                        ) : (
                          <Badge tone="gray">Disabled</Badge>
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
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleActive(user)}
                            disabled={busy || isSelf}
                            className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-40"
                          >
                            {user.isActive ? (
                              <><PowerOff size={14} /> Disable</>
                            ) : (
                              <><Power size={14} /> Enable</>
                            )}
                          </button>
                          <ConfirmActionButton
                            label="Delete"
                            icon={<Trash2 size={14} />}
                            title={`Delete ${user.firstName} ${user.lastName}?`}
                            description={
                              user.references.total > 0
                                ? `This account is linked to ${user.references.total} historical record(s). Deletion will be refused to preserve case history — deactivate the account instead.`
                                : "This account has no linked records and will be permanently removed."
                            }
                            confirmLabel="Delete account"
                            tone="danger"
                            disabled={isSelf}
                            onConfirm={() => deleteUser(user)}
                          />
                          {!isSelf && (
                            <ConfirmActionButton
                              label="Reset password"
                              icon={<Key size={14} />}
                              title={`Reset password for ${user.firstName} ${user.lastName}?`}
                              description="A one-time reset code will be generated and shown to you. Give it to the user; they can redeem it once at the reset-password page. The code expires within 30 minutes."
                              confirmLabel="Generate code"
                              disabled={busy}
                              className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-40"
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-code-title"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h2
              id="reset-code-title"
              className="inline-flex items-center gap-2 text-base font-semibold text-slate-900"
            >
              <Key size={16} className="text-slate-500" />
              One-time reset code for {resetResult.name}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Show this code to the user. It can be redeemed once at{" "}
              <span className="font-medium">/reset-password</span> and expires
              in {resetResult.expiresInMinutes} minutes. Anyone who sees it can
              take over the account, so share it in person.
            </p>
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="break-all text-center font-mono text-lg font-bold tracking-widest text-slate-900">
                {resetResult.code}
              </p>
            </div>
            <Button
              type="button"
              onClick={() => setResetResult(null)}
              className="mt-5 w-full"
            >
              <CheckCircle2 size={16} />
              Got it
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
