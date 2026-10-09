"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label } from "@/components/ui/field";
import { ConfirmActionButton } from "@/components/ui/confirm-action-button";
import { apiRequest } from "@/lib/api-client";
import { copy, type Locale } from "@/lib/i18n";

type Option = { id: number; name: string; code: string };

export type RoutingRuleItem = {
  id: number;
  categoryId: number;
  officeId: number;
  priorityOrder: number;
  isActive: boolean;
  category: Option;
  office: Option;
};

const selectStyles =
  "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

export function RoutingRulesManager({
  rules,
  categories,
  offices,
  locale = "en",
}: {
  rules: RoutingRuleItem[];
  categories: Option[];
  offices: Option[];
  locale?: Locale;
}) {
  const t = copy[locale].admin.mgr;
  const router = useRouter();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState(
    categories[0] ? String(categories[0].id) : ""
  );
  const [officeId, setOfficeId] = useState(
    offices[0] ? String(offices[0].id) : ""
  );
  const [priorityOrder, setPriorityOrder] = useState("1");
  const [isActive, setIsActive] = useState(true);

  // A rule may reference a category/office that has since been deactivated.
  // The picker still needs that option so the rule can be edited instead of
  // silently rendering a blank select (and then failing validation).
  const allCategories = useMemo(() => {
    const known = new Set(categories.map((option) => option.id));
    const extras = rules
      .filter((rule) => !known.has(rule.categoryId))
      .map((rule) => rule.category);
    return [...categories, ...extras];
  }, [categories, rules]);

  const allOffices = useMemo(() => {
    const known = new Set(offices.map((option) => option.id));
    const extras = rules
      .filter((rule) => !known.has(rule.officeId))
      .map((rule) => rule.office);
    return [...offices, ...extras];
  }, [offices, rules]);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");

  function resetForm() {
    setEditingId(null);
    setCategoryId(categories[0] ? String(categories[0].id) : "");
    setOfficeId(offices[0] ? String(offices[0].id) : "");
    setPriorityOrder("1");
    setIsActive(true);
  }

  function startEdit(rule: RoutingRuleItem) {
    setEditingId(rule.id);
    setCategoryId(String(rule.categoryId));
    setOfficeId(String(rule.officeId));
    setPriorityOrder(String(rule.priorityOrder));
    setIsActive(rule.isActive);
    setError(null);
    setSuccess(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!categoryId || !officeId) {
      setError(t.selectBoth);
      return;
    }

    const payload = {
      categoryId: Number(categoryId),
      officeId: Number(officeId),
      priorityOrder: Number(priorityOrder),
      isActive,
    };

    setBusy(true);
    const result = editingId
      ? await apiRequest<{ rule: RoutingRuleItem }>(
          `/api/v1/admin/routing-rules/${editingId}`,
          { method: "PUT", body: JSON.stringify(payload) }
        )
      : await apiRequest<{ rule: RoutingRuleItem }>(
          "/api/v1/admin/routing-rules",
          { method: "POST", body: JSON.stringify(payload) }
        );
    setBusy(false);

    if (!result.success) {
      if (
        result.error.code === "VALIDATION_ERROR" &&
        Array.isArray(result.error.details)
      ) {
        const details = result.error.details as { message: string }[];
        setError(details.map((d) => d.message).join(" "));
      } else {
        setError(result.error.message);
      }
      return;
    }

    setSuccess(editingId ? t.ruleUpdated : t.ruleCreated);
    resetForm();
    router.refresh();
  }

  async function toggleActive(rule: RoutingRuleItem) {
    setError(null);
    setSuccess(null);
    setBusy(true);
    const result = await apiRequest<{ rule: RoutingRuleItem }>(
      `/api/v1/admin/routing-rules/${rule.id}`,
      { method: "PUT", body: JSON.stringify({ isActive: !rule.isActive }) }
    );
    setBusy(false);

    if (!result.success) {
      setError(result.error.message);
      return;
    }
    setSuccess(
      (rule.isActive ? t.ruleDisabled : t.ruleEnabled)
        .replace("{from}", rule.category.code)
        .replace("{to}", rule.office.code)
    );
    router.refresh();
  }

  async function deleteRule(rule: RoutingRuleItem): Promise<string | null> {
    setError(null);
    setSuccess(null);
    const result = await apiRequest<{ deleted: boolean }>(
      `/api/v1/admin/routing-rules/${rule.id}`,
      { method: "DELETE" }
    );
    if (!result.success) {
      if (
        result.error.code === "VALIDATION_ERROR" &&
        Array.isArray(result.error.details)
      ) {
        const details = result.error.details as { message: string }[];
        return details.map((d) => d.message).join(" ");
      }
      return result.error.message;
    }
    setSuccess(
      t.ruleDeleted
        .replace("{from}", rule.category.code)
        .replace("{to}", rule.office.code)
    );
    router.refresh();
    return null;
  }

  const needle = filter.trim().toLowerCase();
  const visibleRules = needle
    ? rules.filter(
        (rule) =>
          rule.category.name.toLowerCase().includes(needle) ||
          rule.category.code.toLowerCase().includes(needle) ||
          rule.office.name.toLowerCase().includes(needle) ||
          rule.office.code.toLowerCase().includes(needle)
      )
    : rules;

  return (
    <div className="space-y-8">
      {success && <FormMessage tone="success">{success}</FormMessage>}
      {error && <FormMessage tone="error">{error}</FormMessage>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <h2 className="text-base font-semibold text-slate-900">
          {editingId ? t.editRule : t.addRule}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label htmlFor="rule-category">{t.category}</Label>
            <select
              id="rule-category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className={selectStyles}
            >
              {allCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="rule-office">{t.responsibleOffice}</Label>
            <select
              id="rule-office"
              value={officeId}
              onChange={(e) => setOfficeId(e.target.value)}
              className={selectStyles}
            >
              {allOffices.map((office) => (
                <option key={office.id} value={office.id}>
                  {office.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="rule-priority">{t.priorityOrder}</Label>
            <Input
              id="rule-priority"
              type="number"
              min={0}
              value={priorityOrder}
              onChange={(e) => setPriorityOrder(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500">{t.orderHint}</p>
          </div>
          <div>
            <Label htmlFor="rule-active">{t.colStatus}</Label>
            <label className="flex h-10 items-center gap-2 text-sm text-slate-700">
              <input
                id="rule-active"
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              {t.active}
            </label>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? t.saving : editingId ? t.saveChanges : t.createRule}
          </Button>
          {editingId && (
            <Button type="button" variant="outline" onClick={resetForm}>
              {t.cancelEdit}
            </Button>
          )}
        </div>
      </form>

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900">
            {needle
              ? t.rulesOf
                  .replace("{shown}", String(visibleRules.length))
                  .replace("{total}", String(rules.length))
              : t.rulesList.replace("{count}", String(visibleRules.length))}
          </h2>
          <Input
            type="search"
            aria-label={t.filterRules}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t.filterRules}
            className="max-w-xs"
          />
        </div>
        {visibleRules.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-600">
            {rules.length === 0 ? t.noRulesYet : t.noRulesMatch}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <caption className="sr-only">{t.rulesCaption}</caption>
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.colCategory}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.colOffice}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.colOrder}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.colStatus}
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    <span className="sr-only">{t.edit}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleRules.map((rule) => (
                  <tr key={rule.id} className="hover:bg-slate-50">
                    <td className="py-3 pr-4 font-medium text-slate-900">
                      {rule.category.name}
                    </td>
                    <td className="py-3 pr-4 text-slate-600">
                      {rule.office.name}
                    </td>
                    <td className="py-3 pr-4 text-slate-600">
                      {rule.priorityOrder}
                    </td>
                    <td className="py-3 pr-4">
                      {rule.isActive ? (
                        <Badge tone="green">{t.active}</Badge>
                      ) : (
                        <Badge tone="gray">{t.disabled}</Badge>
                      )}
                    </td>
                    <td className="py-3">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => startEdit(rule)}
                          className="text-sm font-semibold text-brand-700 hover:text-brand-800"
                        >
                          {t.edit}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleActive(rule)}
                          disabled={busy}
                          className="text-sm font-semibold text-slate-600 hover:text-slate-900"
                        >
                          {rule.isActive ? t.disable : t.enable}
                        </button>
                        <ConfirmActionButton
                          label={t.delete}
                          title={t.deleteRuleTitle}
                          description={t.deleteRuleDesc
                            .replace("{category}", rule.category.name)
                            .replace("{office}", rule.office.name)}
                          confirmLabel={t.deleteRule}
                          tone="danger"
                          onConfirm={() => deleteRule(rule)}
                        />
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
