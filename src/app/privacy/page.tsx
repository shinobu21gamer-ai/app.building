import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "How BarangayResolve collects, uses, and shares information when you submit a community concern.",
};

export default async function PrivacyPage() {
  const locale = await getLocale();
  const t = copy[locale].privacy;

  return (
    <Container className="py-12 sm:py-16">
      <p className="text-sm font-semibold text-brand-700">{t.kicker}</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
        {t.title}
      </h1>
      <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600">
        {t.lead}
      </p>

      <div className="mt-10 space-y-8">
        {t.sections.map((section, index) => (
          <section key={section.title}>
            <h2 className="text-lg font-semibold text-slate-900">
              {index + 1}. {section.title}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
              {section.body}
            </p>
          </section>
        ))}
      </div>

      <p className="mt-10 max-w-2xl text-sm text-slate-500">{t.footer}</p>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button href="/help" variant="outline">
          {t.help}
        </Button>
        <Button href="/" variant="ghost">
          {t.home}
        </Button>
      </div>
    </Container>
  );
}
