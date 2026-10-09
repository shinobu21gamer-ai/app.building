"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label, Textarea } from "@/components/ui/field";
import { ConfirmActionButton } from "@/components/ui/confirm-action-button";
import { apiRequest } from "@/lib/api-client";
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

  function resetForm() {
    setEditingId(null);
    setName("");
    setCode("");
    setDescription("");
    setIsActive(true);
  }

  function startEdit(category: AdminCategoryItem) {
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

    const payload = { name, code, description, isActive };

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

      <form onSubmit={handleSubmit} className="space-y-4">
        <h2 className="text-base font-semibold text-slate-900">
          {editingId ? t.editCategory : t.addCategory}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="category-name">{t.name}</Label>
            <Input
              id="category-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="category-code">{t.code}</Label>
            <Input
              id="category-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="e.g. ROAD"
              required
            />
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

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          {t.availableNew}
        </label>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? t.saving : editingId ? t.saveChanges : t.createCategory}
          </Button>
          {editingId && (
            <Button type="button" variant="outline" onClick={resetForm}>
              {t.cancelEdit}
            </Button>
          )}
        </div>
      </form>

      <div>
        <h2 className="mb-3 text-base font-semibold text-slate-900">
          {t.categoriesList.replace("{count}", String(categories.length))}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <caption className="sr-only">Concern categories</caption>
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
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
            <tbody className="divide-y divide-slate-100">
              {categories.map((category) => (
                <tr key={category.id} className="hover:bg-slate-50">
                  <td className="py-3 pr-4 font-medium text-slate-900">
                    {category.name}
                  </td>
                  <td className="py-3 pr-4 text-slate-600">{category.code}</td>
                  <td className="py-3 pr-4 text-slate-600">
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
                        className="text-sm font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-40"
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
