"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";

export type FilterField = {
  name: string;
  label: string;
  options: { value: string; label: string }[];
};

const selectStyles =
  "h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

export function AdminFilterBar({
  initialQ = "",
  qPlaceholder = "Search...",
  fields = [],
  initialValues = {},
}: {
  initialQ?: string;
  qPlaceholder?: string;
  fields?: FilterField[];
  initialValues?: Record<string, string>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(initialQ);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const field of fields) seed[field.name] = initialValues[field.name] ?? "";
    return seed;
  });

  function apply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = new URLSearchParams();
    if (q.trim()) next.set("q", q.trim());
    for (const field of fields) {
      const value = values[field.name];
      if (value) next.set(field.name, value);
    }
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  function clear() {
    setQ("");
    const reset: Record<string, string> = {};
    for (const field of fields) reset[field.name] = "";
    setValues(reset);
    router.push(pathname);
  }

  return (
    <form
      onSubmit={apply}
      className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3"
    >
      <div className="min-w-[200px] flex-1">
        <label
          htmlFor="admin-filter-q"
          className="mb-1 block text-xs font-medium text-slate-600"
        >
          Search
        </label>
        <input
          id="admin-filter-q"
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder={qPlaceholder}
          className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
        />
      </div>

      {fields.map((field) => (
        <div key={field.name}>
          <label
            htmlFor={`admin-filter-${field.name}`}
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            {field.label}
          </label>
          <select
            id={`admin-filter-${field.name}`}
            value={values[field.name] ?? ""}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                [field.name]: event.target.value,
              }))
            }
            className={selectStyles}
          >
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ))}

      <button
        type="submit"
        className="inline-flex h-10 items-center justify-center rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800"
      >
        Apply
      </button>
      <button
        type="button"
        onClick={clear}
        className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        Clear
      </button>
    </form>
  );
}
