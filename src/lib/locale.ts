import { cookies } from "next/headers";
import { LANG_COOKIE, parseLocale, type Locale } from "@/lib/i18n";

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  return parseLocale(store.get(LANG_COOKIE)?.value);
}
