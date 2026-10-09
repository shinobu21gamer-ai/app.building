import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { RouteLoading } from "./route-loading";

/**
 * Server wrapper behind the `loading.tsx` files. It resolves the visitor's
 * locale for the status label and renders the client fallback, which picks
 * the skeleton shape from the route.
 */
export async function RouteLoadingPage() {
  const locale = await getLocale();
  return <RouteLoading label={copy[locale].loading.label} />;
}
