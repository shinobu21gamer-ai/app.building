"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Power, Save, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  FieldError,
  FormMessage,
  Input,
  Label,
  RequiredLegend,
  Textarea,
} from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useSweetAlert } from "@/components/ui/sweet-alert";
import { apiRequest } from "@/lib/api-client";
import { extractApiError } from "@/lib/utils";
import { describeFieldProblem } from "@/lib/validations/text";
import { copy, type Locale } from "@/lib/i18n";

export type AdminOfficeItem = {
  id: number;
  name: string;
  code: string;
  description: string | null;
  headOfficer: string | null;
  contact: string | null;
  isActive: boolean;
  references: {
    concerns: number;
    assignments: number;
    routingRules: number;
    users: number;
    total: number;
  };
};

function contactHref(contact: string): string | null {
  const trimmed = contact.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return `mailto:${trimmed}`;
  }
  const dialable = trimmed.replace(/[\s().-]/g, "");
  if (/^\+?\d{5,}$/.test(dialable)) return `tel:${dialable}`;
  return null;
}

function OfficeContact({
  contact,
  emptyLabel,
}: {
  contact: string | null;
  emptyLabel: string;
}) {
  if (!contact) {
    return <span className="font-semibold text-amber-700">{emptyLabel}</span>;
  }
  const href = contactHref(contact);
  return href ? (
    <a className="break-all font-medium text-brand-800 underline decoration-brand-300 underline-offset-2 hover:text-brand-950" href={href}>
      {contact}
    </a>
  ) : (
    <span className="break-words font-medium text-ink">{contact}</span>
  );
}

type FormState = {
  name: string;
  code: string;
  description: string;
  headOfficer: string;
  contact: string;
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  code: "",
  description: "",
  headOfficer: "",
  contact: "",
  isActive: true,
};

/**
 * The offices desk.
 *
 * The list is the page; the form is a dialog that only exists while it is being
 * filled in. That order matters on a desk that is read far more often than it
 * is written: an always-open form pushed the offices themselves below the fold,
 * so the page looked like "add an office" rather than "these are the offices".
 *
 * Contact details are held to the same rule the API enforces — a phone number
 * or an email address — so an office cannot be saved with a contact that nobody
 * can dial or write to.
 */
export function OfficeManager({
  offices,
  locale = "en",
}: {
  offices: AdminOfficeItem[];
  locale?: Locale;
}) {
  const t = copy[locale].admin.mgr;
  const common = copy[locale].revamp.common;
  const router = useRouter();
  const { showToast } = useToast();
  const { alert, confirm } = useSweetAlert();

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setError(null);
    setSuccess(null);
    setOpen(true);
  }

  function openEdit(office: AdminOfficeItem) {
    setEditingId(office.id);
    setForm({
      name: office.name,
      code: office.code,
      description: office.description ?? "",
      headOfficer: office.headOfficer ?? "",
      contact: office.contact ?? "",
      isActive: office.isActive,
    });
    setFieldErrors({});
    setError(null);
    setSuccess(null);
    setOpen(true);
  }

  function closeForm() {
    if (busy) return;
    setOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setError(null);
  }

  /** The API is the gate; this mirror answers the same rules without a round trip. */
  function validate(): boolean {
    const problems: Record<string, string> = {};

    const name = describeFieldProblem(form.name, "text", t.officeName);
    if (!form.name.trim()) problems.name = t.nameRequired;
    else if (form.name.trim().length < 2) problems.name = t.nameTooShort;
    else if (name) problems.name = name;

    const code = form.code.trim();
    if (!code) problems.code = t.codeRequired;
    else if (!/^[A-Za-z0-9_]{2,30}$/.test(code)) problems.code = t.codeInvalid;

    const contact = form.contact.trim();
    const contactProblem = describeFieldProblem(contact, "contact", t.contact);
    if (!contact) problems.contact = t.contactRequired;
    else if (contactProblem) problems.contact = contactProblem;

    const head = describeFieldProblem(form.headOfficer, "name", t.headOfficer);
    if (head) problems.headOfficer = head;

    setFieldErrors(problems);
    return Object.keys(problems).length === 0;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (!validate()) return;

    const payload = {
      name: form.name.trim(),
      code: form.code.trim(),
      description: form.description,
      headOfficer: form.headOfficer.trim(),
      contact: form.contact.trim(),
      isActive: form.isActive,
    };

    setBusy(true);
    const result = editingId
      ? await apiRequest<{ office: AdminOfficeItem }>(
          `/api/v1/admin/offices/${editingId}`,
          { method: "PATCH", body: JSON.stringify(payload) }
        )
      : await apiRequest<{ office: AdminOfficeItem }>("/api/v1/admin/offices", {
          method: "POST",
          body: JSON.stringify(payload),
        });
    setBusy(false);

    if (!result.success) {
      const message = extractApiError(result.error);
      setError(message);
      showToast("error", message);
      return;
    }

    const message = editingId ? t.officeUpdated : t.officeCreated;
    setSuccess(message);
    closeForm();
    await alert({
      tone: "success",
      title: editingId ? t.officeUpdated : t.officeCreated,
      text: `${payload.name} (${payload.code.toUpperCase()})`,
    });
    router.refresh();
  }

  async function toggleActive(office: AdminOfficeItem) {
    const accepted = await confirm({
      tone: office.isActive ? "warning" : "question",
      title: (office.isActive ? t.confirmDisableOffice : t.confirmEnableOffice).replace(
        "{name}",
        office.name
      ),
      text: office.isActive ? t.disableOfficeText : t.enableOfficeText,
      confirmLabel: office.isActive ? t.disable : t.enable,
    });
    if (!accepted) return;

    setError(null);
    setSuccess(null);
    setBusy(true);
    const result = await apiRequest<{ office: AdminOfficeItem }>(
      `/api/v1/admin/offices/${office.id}`,
      { method: "PATCH", body: JSON.stringify({ isActive: !office.isActive }) }
    );
    setBusy(false);
    if (!result.success) {
      const message = extractApiError(result.error);
      setError(message);
      showToast("error", message);
      return;
    }
    const message = (
      office.isActive ? t.officeDisabled : t.officeEnabled
    ).replace("{name}", office.name);
    setSuccess(message);
    showToast("success", message);
    router.refresh();
  }

  async function deleteOffice(office: AdminOfficeItem) {
    const linked = office.references.total > 0;
    const accepted = await confirm({
      tone: "error",
      title: t.deleteOfficeTitle.replace("{name}", office.name),
      text: linked
        ? t.deleteOfficeLinked.replace("{count}", String(office.references.total))
        : t.deleteOfficeEmpty,
      confirmLabel: t.deleteOffice,
      cancelLabel: t.cancelAction,
    });
    if (!accepted) return;

    setError(null);
    setSuccess(null);
    const result = await apiRequest<{ deleted: boolean }>(
      `/api/v1/admin/offices/${office.id}`,
      { method: "DELETE" }
    );
    if (!result.success) {
      const message = extractApiError(result.error);
      setError(message);
      await alert({ tone: "error", title: t.deleteOffice, text: message });
      return;
    }
    const message = t.deletedOffice.replace("{code}", office.code);
    setSuccess(message);
    showToast("success", message);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {success && <FormMessage tone="success">{success}</FormMessage>}
      {error && <FormMessage tone="error">{error}</FormMessage>}

      <section aria-labelledby="offices-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="offices-heading" className="text-lg font-semibold text-ink">
              {t.officesList}{" "}
              <span className="text-base font-medium text-ink-subtle">
                ({offices.length})
              </span>
            </h2>
            <p className="mt-0.5 text-sm text-ink-muted">{t.contactShown}</p>
          </div>
          <Button type="button" onClick={openCreate}>
            <Plus size={16} aria-hidden="true" />
            {t.addOffice}
          </Button>
        </div>

        {offices.length === 0 ? (
          <p className="mt-4 rounded-card border border-dashed border-line-strong bg-surface-muted p-6 text-center text-sm text-ink-muted">
            {t.noOffices}
          </p>
        ) : (
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            {offices.map((office) => (
              <article
                key={office.id}
                className="rounded-card border border-line bg-surface p-4 shadow-card transition-shadow hover:shadow-md sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="break-words text-base font-semibold text-ink">{office.name}</h3>
                      {office.isActive ? (
                        <Badge tone="green">{t.active}</Badge>
                      ) : (
                        <Badge tone="gray">{t.disabled}</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm font-medium text-ink-muted">
                      {office.code}
                      <span className="px-2 text-line-strong" aria-hidden="true">·</span>
                      {t.linkedRecords.replace(
                        "{count}",
                        String(office.references.total)
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => openEdit(office)}
                      aria-label={`Edit ${office.name}`}
                    >
                      <Pencil size={14} aria-hidden="true" />
                      {t.edit}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => toggleActive(office)}
                      aria-label={`${office.isActive ? t.disable : t.enable} ${office.name}`}
                    >
                      <Power size={14} aria-hidden="true" />
                      {office.isActive ? t.disable : t.enable}
                    </Button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => deleteOffice(office)}
                      aria-label={`${t.delete} ${office.name}`}
                      className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-control px-2.5 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-40"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      {t.delete}
                    </button>
                  </div>
                </div>

                <dl className="mt-4 grid gap-x-4 gap-y-4 border-t border-line pt-4 sm:grid-cols-2">
                  <div className="min-w-0">
                    <dt className="text-xs font-bold uppercase tracking-wide text-ink-subtle">
                      {t.contact}
                    </dt>
                    <dd className="mt-1 text-sm leading-6">
                      <OfficeContact contact={office.contact} emptyLabel={t.addContact} />
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs font-bold uppercase tracking-wide text-ink-subtle">
                      {t.headOfficer}
                    </dt>
                    <dd className="mt-1 break-words text-sm leading-6 text-ink">
                      {office.headOfficer || t.notAssigned}
                    </dd>
                  </div>
                  {office.description && (
                    <div className="sm:col-span-2">
                      <dt className="text-xs font-bold uppercase tracking-wide text-ink-subtle">
                        {t.services}
                      </dt>
                      <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink-muted">{office.description}</dd>
                    </div>
                  )}
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <Modal
        open={open}
        onClose={closeForm}
        title={editingId ? t.editOffice : t.addOffice}
        description={t.officeLead}
        size="lg"
        closeLabel={common.close}
      >
        <form onSubmit={handleSubmit} className="space-y-5">
          <RequiredLegend>{copy[locale].register.requiredLegend}</RequiredLegend>

          <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="office-name" required>{t.officeName}</Label>
              <Input
                id="office-name"
                value={form.name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
                autoComplete="organization"
                invalid={Boolean(fieldErrors.name)}
                required
              />
              {fieldErrors.name && <FieldError>{fieldErrors.name}</FieldError>}
            </div>
            <div>
              <Label htmlFor="office-code" required>{t.officeCode}</Label>
              <Input
                id="office-code"
                value={form.code}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, code: event.target.value }))
                }
                placeholder="e.g. INFRA"
                invalid={Boolean(fieldErrors.code)}
                required
              />
              {fieldErrors.code ? (
                <FieldError>{fieldErrors.code}</FieldError>
              ) : (
                <p className="mt-1 text-xs text-ink-subtle">{t.codeHint}</p>
              )}
            </div>
            <div>
              <Label htmlFor="office-head">{t.headOfficer}</Label>
              <Input
                id="office-head"
                value={form.headOfficer}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, headOfficer: event.target.value }))
                }
                placeholder={t.optional}
                invalid={Boolean(fieldErrors.headOfficer)}
              />
              {fieldErrors.headOfficer && (
                <FieldError>{fieldErrors.headOfficer}</FieldError>
              )}
            </div>
            <div>
              <Label htmlFor="office-contact">
                {t.contact}{" "}
                <span className="font-semibold text-red-700">{t.required}</span>
              </Label>
              <Input
                id="office-contact"
                type="text"
                value={form.contact}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, contact: event.target.value }))
                }
                placeholder={t.contactPlaceholder}
                autoComplete="tel"
                invalid={Boolean(fieldErrors.contact)}
                required
                maxLength={120}
              />
              {fieldErrors.contact ? (
                <FieldError>{fieldErrors.contact}</FieldError>
              ) : (
                <p className="mt-1 text-xs text-ink-subtle">{t.contactHint}</p>
              )}
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="office-description">{t.officeDesc}</Label>
              <Textarea
                id="office-description"
                rows={2}
                value={form.description}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, description: event.target.value }))
                }
                placeholder={t.officeDescPlaceholder}
                maxLength={500}
              />
            </div>
          </div>

          <label className="flex min-h-11 items-center gap-3 rounded-control border border-line bg-surface-muted px-3 text-sm font-medium text-ink">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, isActive: event.target.checked }))
              }
              className="h-4 w-4 rounded border-line-strong accent-brand-700"
            />
            {t.accepting}
          </label>

          {error && <FormMessage tone="error">{error}</FormMessage>}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy} loading={busy}>
              {editingId ? <Save size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
              {busy ? t.saving : editingId ? t.saveChanges : t.createOffice}
            </Button>
            <Button type="button" variant="outline" onClick={closeForm} disabled={busy}>
              {t.cancelEdit}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
