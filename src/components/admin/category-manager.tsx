"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label, RequiredLegend, Textarea } from "@/components/ui/field";
import { ConfirmActionButton } from "@/components/ui/confirm-action-button";
import { Modal } from "@/components/ui/modal";
import { FieldError } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { describeFieldProblem } from "@/lib/validations/text";
import { extractApiError } from "@/lib/utils";
import { copy, type Locale } from "@/lib/i18n";

export type AdminCategoryItem = {
  id: number;
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
  references: { concerns: number; routingRules: number; total: number };
};

export function CategoryManager({
  categories,
  locale = "en",
}: {
  categories: AdminCategoryItem[];
  locale?: Locale;
}) {
  const t = copy[locale].admin.mgr;
  const router = useRouter();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The form lives behind a button; the table is the page.
  const [formOpen, setFormOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function resetForm() {
    setEditingId(null);
    setName("");
    setCode("");
    setDescription("");
    setIsActive(true);
  }

  function startCreate() {
    resetForm();
    setFieldErrors({});
    setError(null);
    setSuccess(null);
    setFormOpen(true);
  }

  function closeForm() {
    if (busy) return;
    resetForm();
    setFieldErrors({});
    setError(null);
    setFormOpen(false);
  }

  function startEdit(category: AdminCategoryItem) {
    setFormOpen(true);
    setFieldErrors({});
    setEditingId(category.id);
    setName(category.name);
    setCode(category.code);
    setDescription(category.description ?? "");
    setIsActive(category.isActive);
    setError(null);
    setSuccess(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const problems: Record<string, string> = {};
    const nameProblem = describeFieldProblem(name, "text", t.name);
    if (!name.trim()) problems.name = t.nameRequired;
    else if (nameProblem) problems.name = nameProblem;
    const trimmedCode = code.trim();
    if (!trimmedCode) problems.code = t.codeRequired;
    else if (!/^[A-Za-z0-9_]{2,30}$/.test(trimmedCode)) problems.code = t.codeInvalid;
    setFieldErrors(problems);
    if (Object.keys(problems).length > 0) return;

    const payload = { name: name.trim(), code: trimmedCode, description, isActive };

    setBusy(true);
    const result = editingId
      ? await apiRequest<{ category: AdminCategoryItem }>(
          `/api/v1/admin/concern-categories/${editingId}`,
          { method: "PATCH", body: JSON.stringify(payload) }
        )
      : await apiRequest<{ category: AdminCategoryItem }>(
          "/api/v1/admin/concern-categories",
          { method: "POST", body: JSON.stringify(payload) }
        );
    setBusy(false);

    if (!result.success) {
      setError(extractApiError(result.error));
      return;
    }
    setSuccess(editingId ? t.categoryUpdated : t.categoryCreated);
    resetForm();
    setFormOpen(false);
    router.refresh();
  }

  async function toggleActive(category: AdminCategoryItem) {
    setError(null);
    setSuccess(null);
    setBusy(true);
    const result = await apiRequest<{ category: AdminCategoryItem }>(
      `/api/v1/admin/concern-categories/${category.id}`,
      { method: "PATCH", body: JSON.stringify({ isActive: !category.isActive }) }
    );
    setBusy(false);
    if (!result.success) {
      setError(extractApiError(result.error));
      return;
    }
    setSuccess(
      (category.isActive ? t.categoryDisabled : t.categoryEnabled).replace(
        "{name}",
        category.name
      )
    );
    router.refresh();
  }

  async function deleteCategory(
    category: AdminCategoryItem
  ): Promise<string | null> {
    setError(null);
    setSuccess(null);
    const result = await apiRequest<{ deleted: boolean }>(
      `/api/v1/admin/concern-categories/${category.id}`,
      { method: "DELETE" }
    );
    if (!result.success) return extractApiError(result.error);
    setSuccess(t.deletedCategory.replace("{code}", category.code));
    router.refresh();
    return null;
  }

  return (
    <div className="space-y-8">
      {success && <FormMessage tone="success">{success}</FormMessage>}
      {error && <FormMessage tone="error">{error}</FormMessage>}

      <Modal
        open={formOpen}
        onClose={closeForm}
        title={editingId ? t.editCategory : t.addCategory}
        description={t.categoryLead}
        size="md"
        closeLabel={copy[locale].revamp.common.close}
      >
      <form onSubmit={handleSubmit} className="space-y-4">
        <RequiredLegend>{copy[locale].register.requiredLegend}</RequiredLegend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="category-name" required>{t.name}</Label>
            <Input
              id="category-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              invalid={Boolean(fieldErrors.name)}
              required
            />
            {fieldErrors.name && <FieldError>{fieldErrors.name}</FieldError>}
          </div>
          <div>
            <Label htmlFor="category-code" required>{t.code}</Label>
            <Input
              id="category-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="e.g. ROAD"
              invalid={Boolean(fieldErrors.code)}
              required
            />
            {fieldErrors.code ? (
              <FieldError>{fieldErrors.code}</FieldError>
            ) : (
              <p className="mt-1 text-xs text-ink-subtle">{t.codeHint}</p>
            )}
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="category-description">{t.description}</Label>
            <Textarea
              id="category-description"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t.optional}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
            className="h-4 w-4 rounded border-line-strong"
          />
          {t.availableNew}
        </label>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy} loading={busy}>
            {busy ? t.saving : editingId ? t.saveChanges : t.createCategory}
          </Button>
          <Button type="button" variant="outline" onClick={closeForm} disabled={busy}>
            {editingId ? t.cancelEdit : t.cancelAction}
          </Button>
        </div>
      </form>
      </Modal>

      <div>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-base font-semibold text-ink">
            {t.categoriesList.replace("{count}", String(categories.length))}
          </h2>
          <Button type="button" onClick={startCreate}>
            {t.addCategory}
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <caption className="sr-only">Concern categories</caption>
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-subtle">
                <th scope="col" className="py-2 pr-4 font-semibold">
                  {t.name}
                </th>
                <th scope="col" className="py-2 pr-4 font-semibold">
                  {t.code}
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
              {categories.map((category) => (
                <tr key={category.id} className="hover:bg-surface-muted">
                  <td className="py-3 pr-4 font-medium text-ink">
                    {category.name}
                  </td>
                  <td className="py-3 pr-4 text-ink-muted">{category.code}</td>
                  <td className="py-3 pr-4 text-ink-muted">
                    {category.references.total}
                  </td>
                  <td className="py-3 pr-4">
                    {category.isActive ? (
                      <Badge tone="green">{t.active}</Badge>
                    ) : (
                      <Badge tone="gray">{t.disabled}</Badge>
                    )}
                  </td>
                  <td className="py-3">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => startEdit(category)}
                        className="text-sm font-semibold text-brand-700 hover:text-brand-800"
                      >
                        {t.edit}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleActive(category)}
                        disabled={busy}
                        className="text-sm font-semibold text-ink-muted hover:text-ink disabled:opacity-40"
                      >
                        {category.isActive ? t.disable : t.enable}
                      </button>
                      <ConfirmActionButton
                        label={t.delete}
                        title={t.deleteCategoryTitle.replace("{name}", category.name)}
                        description={
                          category.references.total > 0
                            ? t.deleteCategoryLinked.replace(
                                "{count}",
                                String(category.references.total)
                              )
                            : t.deleteCategoryEmpty
                        }
                        confirmLabel={t.deleteCategory}
                        tone="danger"
                        cancelLabel={t.cancelAction}
                        busyLabel={t.workingEllipsis}
                        onConfirm={() => deleteCategory(category)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
