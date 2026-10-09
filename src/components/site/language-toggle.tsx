"use client";

import { useRouter } from "next/navigation";
import { LANG_COOKIE, type Locale } from "@/lib/i18n";

export function LanguageToggle({
  locale,
  label,
}: {
  locale: Locale;
  label: string;
}) {
  const router = useRouter();

  function setLocale(next: Locale) {
    document.cookie = `${LANG_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    router.refresh();
  }

  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex rounded-lg border border-slate-200 p-0.5 text-xs font-semibold"
    >
      {(["en", "fil"] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={locale === value}
          onClick={() => setLocale(value)}
          className={
            locale === value
              ? "rounded-md bg-brand-700 px-2 py-1 text-white"
              : "rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100"
          }
        >
          {value === "en" ? "EN" : "FIL"}
        </button>
      ))}
    </div>
  );
}
