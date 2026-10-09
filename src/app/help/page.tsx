import type { Metadata } from "next";
import {
  ClipboardList,
  Eye,
  Phone,
  ShieldAlert,
  UserRound,
} from "lucide-react";
import { Container } from "@/components/ui/container";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FaqList } from "@/components/site/faq-list";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "Help",
  description:
    "How to submit and track a barangay concern, what this system is for, and when to call 911 instead.",
};

const STEP_ICONS = {
  account: UserRound,
  submit: ClipboardList,
  follow: Eye,
} as const;

export default async function HelpPage() {
  const locale = await getLocale();
  const t = copy[locale];

  return (
    <Container className="py-12 sm:py-16">
      <p className="text-sm font-semibold text-brand-700">{t.help.kicker}</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
        {t.help.title}
      </h1>
      <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600">
        {t.help.lead}
      </p>

      <section
        id="emergencies"
        className="mt-8 scroll-mt-24 rounded-xl border border-red-200 bg-red-50 p-5"
      >
        <div className="flex gap-3">
          <ShieldAlert
            className="mt-0.5 shrink-0 text-red-700"
            size={22}
            aria-hidden="true"
          />
          <div>
            <h2 className="text-base font-semibold text-red-950">
              {t.emergency.heading}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-red-900">
              {t.emergency.body}
            </p>
            {locale === "en" ? (
              <p className="mt-2 text-sm leading-relaxed text-red-800">
                {t.emergency.filipino}
              </p>
            ) : null}
            <p className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-red-950">
              <Phone size={16} aria-hidden="true" />
              Emergency: 911
            </p>
          </div>
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-semibold text-slate-900">
          {t.help.residents}
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {t.help.steps.map((step) => {
            const Icon = STEP_ICONS[step.key as keyof typeof STEP_ICONS];
            return (
              <Card key={step.key}>
                <p className="flex items-center gap-2 text-base font-semibold text-slate-900">
                  {Icon ? (
                    <Icon
                      size={18}
                      className="text-brand-700"
                      aria-hidden="true"
                    />
                  ) : null}
                  {step.title}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  {step.body}
                </p>
              </Card>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button href="/register">{t.help.createAccount}</Button>
          <Button href="/login" variant="outline">
            {t.help.signIn}
          </Button>
          <Button href="/track" variant="ghost">
            {t.help.track}
          </Button>
        </div>
      </section>

      <section className="mt-12 grid gap-4 sm:grid-cols-2">
        <Card title={t.help.officialTitle} description={t.help.officialDesc}>
          <p className="text-sm leading-relaxed text-slate-600">
            {t.help.officialBody}
          </p>
        </Card>
        <Card title={t.help.adminTitle} description={t.help.adminDesc}>
          <p className="text-sm leading-relaxed text-slate-600">
            {t.help.adminBody}
          </p>
        </Card>
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-semibold text-slate-900">{t.help.faqTitle}</h2>
        <p className="mt-1 mb-4 text-sm text-slate-600">{t.help.faqLead}</p>
        <FaqList items={t.faqs} />
      </section>
    </Container>
  );
}
