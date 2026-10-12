import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { PRIVACY_POLICY_VERSION } from "@/lib/privacy/catalog";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "How BarangayResolve collects, uses, and shares information when you submit a community concern.",
};

export default async function PrivacyPage() {
  const locale = await getLocale();
  const t = copy[locale].privacy;
  const rights = copy[locale].revamp.privacyNotice;

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

      {/* RA 10173 rights and the self-service tools that implement them. */}
      <Card
        className="mt-8"
        title={rights.title}
        description={rights.lead}
      >
        <ul className="space-y-3">
          {rights.items.map((item) => (
            <li key={item.title}>
              <p className="text-sm font-medium text-slate-900">{item.title}</p>
              <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-slate-600">
                {item.body}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-slate-500">
          {rights.versionLabel}: v{PRIVACY_POLICY_VERSION}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button href="/privacy/requests" size="sm">
            {rights.cta}
          </Button>
          <Button href="/resident/verification" variant="outline" size="sm">
            {rights.verificationCta}
          </Button>
        </div>
      </Card>

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
