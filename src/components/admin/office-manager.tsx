"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Power, Save, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label, Textarea } from "@/components/ui/field";
import { ConfirmActionButton } from "@/components/ui/confirm-action-button";
import { apiRequest } from "@/lib/api-client";
import { extractApiError } from "@/lib/utils";
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
    <span className="break-words font-medium text-slate-800">{contact}</span>
  );
}

export function OfficeManager({
  offices,
  locale = "en",
}: {
  offices: AdminOfficeItem[];
  locale?: Locale;
}) {
  const t = copy[locale].admin.mgr;
  const router = useRouter();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [headOfficer, setHeadOfficer] = useState("");
  const [contact, setContact] = useState("");
  const [isActive, setIsActive] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function resetForm() {
    setEditingId(null);
    setName("");
    setCode("");
    setDescription("");
    setHeadOfficer("");
    setContact("");
    setIsActive(true);
  }

  function startEdit(office: AdminOfficeItem) {
    setEditingId(office.id);
    setName(office.name);
    setCode(office.code);
    setDescription(office.description ?? "");
    setHeadOfficer(office.headOfficer ?? "");
    setContact(office.contact ?? "");
    setIsActive(office.isActive);
    setError(null);
    setSuccess(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!contact.trim()) {
      setError(t.contactRequired);
      return;
    }
    const payload = {
      name,
      code,
      description,
      headOfficer,
      contact,
      isActive,
    };

    setBusy(true);
    const result = editingId
      ? await apiRequest<{ office: AdminOfficeItem }>(
          `/api/v1/admin/offices/${editingId}`,
          { method: "PATCH", body: JSON.stringify(payload) }
        )
      : await apiRequest<{ office: AdminOfficeItem }>(
          "/api/v1/admin/offices",
          { method: "POST", body: JSON.stringify(payload) }
        );
    setBusy(false);

    if (!result.success) {
      setError(extractApiError(result.error));
      return;
    }
    setSuccess(editingId ? t.officeUpdated : t.officeCreated);
    resetForm();
    router.refresh();
  }

  async function toggleActive(office: AdminOfficeItem) {
    setError(null);
    setSuccess(null);
    setBusy(true);
    const result = await apiRequest<{ office: AdminOfficeItem }>(
      `/api/v1/admin/offices/${office.id}`,
      { method: "PATCH", body: JSON.stringify({ isActive: !office.isActive }) }
    );
    setBusy(false);
    if (!result.success) {
      setError(extractApiError(result.error));
      return;
    }
    setSuccess(
      (office.isActive ? t.officeDisabled : t.officeEnabled).replace(
        "{name}",
        office.name
      )
    );
    router.refresh();
  }

  async function deleteOffice(office: AdminOfficeItem): Promise<string | null> {
    setError(null);
    setSuccess(null);
    const result = await apiRequest<{ deleted: boolean }>(
      `/api/v1/admin/offices/${office.id}`,
      { method: "DELETE" }
    );
    if (!result.success) return extractApiError(result.error);
    setSuccess(t.deletedOffice.replace("{code}", office.code));
    router.refresh();
    return null;
  }

  return (
    <div className="space-y-9">
      {success && <FormMessage tone="success">{success}</FormMessage>}
      {error && <FormMessage tone="error">{error}</FormMessage>}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            {editingId ? t.editOffice : t.addOffice}
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">{t.officeLead}</p>
        </div>

        <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="office-name">{t.officeName}</Label>
            <Input
              id="office-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="organization"
              required
            />
          </div>
          <div>
            <Label htmlFor="office-code">{t.officeCode}</Label>
            <Input
              id="office-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="e.g. INFRA"
              required
            />
          </div>
          <div>
            <Label htmlFor="office-head">{t.headOfficer}</Label>
            <Input
              id="office-head"
              value={headOfficer}
              onChange={(event) => setHeadOfficer(event.target.value)}
              placeholder={t.optional}
            />
          </div>
          <div>
            <Label htmlFor="office-contact">
              {t.contact}{" "}
              <span className="font-semibold text-red-700">{t.required}</span>
            </Label>
            <Input
              id="office-contact"
              type="text"
              value={contact}
              onChange={(event) => setContact(event.target.value)}
              placeholder={t.contactPlaceholder}
              autoComplete="tel"
              required
              minLength={3}
              maxLength={120}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="office-description">{t.officeDesc}</Label>
            <Textarea
              id="office-description"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t.officeDescPlaceholder}
              maxLength={500}
            />
          </div>
        </div>

        <label className="flex min-h-11 items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-800">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 accent-brand-700"
          />
          {t.accepting}
        </label>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {editingId ? <Save size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
            {busy ? t.saving : editingId ? t.saveChanges : t.createOffice}
          </Button>
          {editingId && (
            <Button type="button" variant="outline" onClick={resetForm} disabled={busy}>
              <X size={16} aria-hidden="true" />
              {t.cancelEdit}
            </Button>
          )}
        </div>
      </form>

      <section aria-labelledby="offices-heading" className="border-t border-slate-200 pt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="offices-heading" className="text-lg font-semibold text-slate-900">
            {t.officesList}{" "}
            <span className="text-base font-medium text-slate-500">({offices.length})</span>
          </h2>
          <p className="text-sm text-slate-600">{t.contactShown}</p>
        </div>

        {offices.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">
            {t.noOffices}
          </p>
        ) : (
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            {offices.map((office) => (
              <article
                key={office.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="break-words text-base font-semibold text-slate-900">{office.name}</h3>
                      {office.isActive ? (
                        <Badge tone="green">{t.active}</Badge>
                      ) : (
                        <Badge tone="gray">{t.disabled}</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm font-medium text-slate-600">
                      {office.code}
                      <span className="px-2 text-slate-300" aria-hidden="true">·</span>
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
                      onClick={() => startEdit(office)}
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
                    <ConfirmActionButton
                      label={t.delete}
                      icon={<Trash2 size={14} aria-hidden="true" />}
                      title={t.deleteOfficeTitle.replace("{name}", office.name)}
                      description={
                        office.references.total > 0
                          ? t.deleteOfficeLinked.replace(
                              "{count}",
                              String(office.references.total)
                            )
                          : t.deleteOfficeEmpty
                      }
                      confirmLabel={t.deleteOffice}
                      tone="danger"
                      disabled={busy}
                      className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-40"
                      onConfirm={() => deleteOffice(office)}
                    />
                  </div>
                </div>

                <dl className="mt-4 grid gap-x-4 gap-y-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
                  <div className="min-w-0">
                    <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
                      {t.contact}
                    </dt>
                    <dd className="mt-1 text-sm leading-6">
                      <OfficeContact contact={office.contact} emptyLabel={t.addContact} />
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
                      {t.headOfficer}
                    </dt>
                    <dd className="mt-1 break-words text-sm leading-6 text-slate-800">
                      {office.headOfficer || t.notAssigned}
                    </dd>
                  </div>
                  {office.description && (
                    <div className="sm:col-span-2">
                      <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        {t.services}
                      </dt>
                      <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{office.description}</dd>
                    </div>
                  )}
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
