import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "Citizen's Charter",
  description:
    "Who may use BarangayResolve, what is required, how long a step should take, and how to complain if the hall is silent.",
};

export default async function CharterPage() {
  const locale = await getLocale();
  const t = copy[locale].charter;

  return (
    <Container className="py-12 sm:py-16">
      <p className="text-sm font-semibold text-brand-700">{t.kicker}</p>
      <h1 className="mt-2 text-display text-ink">{t.title}</h1>
      <p className="mt-3 max-w-3xl text-base leading-relaxed text-ink-muted">
        {t.lead}
      </p>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-subtle">
        {t.legal}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button href="/register" size="sm">
          {copy[locale].home.createAccount}
        </Button>
        <Button href="/help" size="sm" variant="outline">
          {copy[locale].footer.help}
        </Button>
        <Button href="/privacy" size="sm" variant="ghost">
          {copy[locale].footer.privacy}
        </Button>
      </div>

      <section className="mt-10">
        <h2 className="text-subtitle text-ink">{t.notTitle}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {t.notItems.map((item) => (
            <Card key={item.title} title={item.title}>
              <p className="text-sm leading-relaxed text-ink-muted">{item.body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-subtitle text-ink">{t.servicesTitle}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">
          {t.servicesLead}
        </p>
        <div className="mt-4 overflow-x-auto rounded-card border border-line">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-surface-muted text-ink-subtle">
              <tr>
                <th className="px-3 py-2 font-semibold">{t.colService}</th>
                <th className="px-3 py-2 font-semibold">{t.colWho}</th>
                <th className="px-3 py-2 font-semibold">{t.colNeed}</th>
                <th className="px-3 py-2 font-semibold">{t.colTime}</th>
                <th className="px-3 py-2 font-semibold">{t.colResult}</th>
              </tr>
            </thead>
            <tbody>
              {t.services.map((row) => (
                <tr key={row.name} className="border-t border-line align-top">
                  <td className="px-3 py-3 font-medium text-ink">{row.name}</td>
                  <td className="px-3 py-3 text-ink-muted">{row.who}</td>
                  <td className="px-3 py-3 text-ink-muted">{row.need}</td>
                  <td className="px-3 py-3 text-ink-muted">{row.time}</td>
                  <td className="px-3 py-3 text-ink-muted">{row.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-subtitle text-ink">{t.whoTitle}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">
          {t.whoLead}
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {t.roles.map((role) => (
            <Card key={role.title} title={role.title}>
              <p className="text-sm leading-relaxed text-ink">
                <span className="font-semibold">{t.canLabel}. </span>
                {role.can}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                <span className="font-semibold text-ink">{t.cannotLabel}. </span>
                {role.cannot}
              </p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mt-12 grid gap-4 lg:grid-cols-2">
        <Card title={t.moneyTitle}>
          <p className="text-sm leading-relaxed text-ink-muted">{t.moneyBody}</p>
        </Card>
        <Card title={t.complainTitle}>
          <p className="text-sm leading-relaxed text-ink-muted">{t.complainBody}</p>
        </Card>
      </section>
    </Container>
  );
}
