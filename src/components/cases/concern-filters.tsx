"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/field";
import { CASE_STATUSES, PRIORITY_LEVELS } from "@/lib/cases/workflow";
import { copy, type Locale } from "@/lib/i18n";

export type FilterOffice = { id: number; name: string };

const selectStyles =
  "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";
const inputStyles =
  "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

export function ConcernFilters({
  action,
  categories,
  offices,
  showOfficeScope,
  defaults,
  locale = "en",
}: {
  action: string;
  categories: { id: number; name: string }[];
  offices: FilterOffice[];
  showOfficeScope: boolean;
  defaults: {
    q: string;
    status: string;
    priority: string;
    categoryId: string;
    officeId: string;
    from: string;
    to: string;
  };
  locale?: Locale;
}) {
  const t = copy[locale].filters;
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    for (const key of [
      "q",
      "status",
      "priority",
      "categoryId",
      "officeId",
      "from",
      "to",
    ]) {
      const value = String(data.get(key) ?? "").trim();
      if (value) params.set(key, value);
    }
    setSubmitting(true);
    const query = params.toString();
    router.push(query ? `${action}?${query}` : action);
    setSubmitting(false);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-2">
          <Label htmlFor="filter-q">{t.search}</Label>
          <input
            id="filter-q"
            name="q"
            type="search"
            defaultValue={defaults.q}
            placeholder={t.searchPlaceholder}
            className={inputStyles}
          />
        </div>

        <div>
          <Label htmlFor="filter-status">{t.status}</Label>
          <select
            id="filter-status"
            name="status"
            defaultValue={defaults.status}
            className={selectStyles}
          >
            <option value="">{t.anyStatus}</option>
            {CASE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="filter-priority">{t.priority}</Label>
          <select
            id="filter-priority"
            name="priority"
            defaultValue={defaults.priority}
            className={selectStyles}
          >
            <option value="">{t.anyPriority}</option>
            {PRIORITY_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="filter-category">{t.category}</Label>
          <select
            id="filter-category"
            name="categoryId"
            defaultValue={defaults.categoryId}
            className={selectStyles}
          >
            <option value="">{t.anyCategory}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        {showOfficeScope && (
          <div>
            <Label htmlFor="filter-office">{t.office}</Label>
            <select
              id="filter-office"
              name="officeId"
              defaultValue={defaults.officeId}
              className={selectStyles}
            >
              <option value="">{t.allOffices}</option>
              {offices.map((office) => (
                <option key={office.id} value={office.id}>
                  {office.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <Label htmlFor="filter-from">{t.from}</Label>
          <input
            id="filter-from"
            name="from"
            type="date"
            defaultValue={defaults.from}
            className={inputStyles}
          />
        </div>

        <div>
          <Label htmlFor="filter-to">{t.to}</Label>
          <input
            id="filter-to"
            name="to"
            type="date"
            defaultValue={defaults.to}
            className={inputStyles}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? t.applying : t.apply}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => router.push(action)}
        >
          {t.clear}
        </Button>
      </div>
    </form>
  );
}
