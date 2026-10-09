import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ClipboardCheck,
  Construction,
  Eye,
  GitBranch,
  HeartPulse,
  Lightbulb,
  MapPin,
  Recycle,
  Route,
  Shield,
  ShieldAlert,
  Users,
  UserRound,
  Landmark,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FaqList } from "@/components/site/faq-list";
import { getAuthUser, roleHome } from "@/lib/auth/session";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "Home",
  description:
    "Report a community concern to your barangay, get a case number, and track it until it is resolved.",
};

const WORKFLOW_ICONS = {
  submit: ClipboardCheck,
  prioritize: Shield,
  route: GitBranch,
  process: Route,
  resolve: Landmark,
  track: Eye,
} as const;

const REPORT_ICONS = {
  roads: Construction,
  waste: Recycle,
  peace: Shield,
  health: HeartPulse,
  lights: Lightbulb,
  places: MapPin,
} as const;

const ROLE_ICONS = {
  residents: Users,
  officials: UserRound,
  admins: Landmark,
} as const;

/** Staggers an entrance animation without a utility class per step. */
function delay(ms: number): React.CSSProperties {
  return { animationDelay: `${ms}ms` };
}

export default async function Home() {
  const user = await getAuthUser();
  const locale = await getLocale();
  const t = copy[locale];

  return (
    <>
      <section className="animate-drop-in border-b border-red-200 bg-red-50">
        <Container className="flex gap-3 py-3">
          <ShieldAlert
            className="mt-0.5 shrink-0 text-red-700"
            size={18}
            aria-hidden="true"
          />
          <p className="text-sm leading-relaxed text-red-950">
            <span className="font-semibold">{t.emergency.heading}.</span>{" "}
            {t.emergency.body}{" "}
            {locale === "en" ? (
              <span className="text-red-800">{t.emergency.filipino}</span>
            ) : null}{" "}
            <Link
              href="/help#emergencies"
              className="font-semibold text-red-900 underline decoration-red-300 underline-offset-2 hover:text-red-950"
            >
              {t.emergency.call911}
            </Link>
          </p>
        </Container>
      </section>

      <section className="relative overflow-hidden bg-gradient-to-b from-brand-50 to-white">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-32 top-10 h-96 w-96 rounded-full bg-brand-200/50 blur-3xl animate-float"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 top-24 h-72 w-72 rounded-full bg-sky-200/50 blur-3xl animate-float-slow"
        />
        <Container className="relative grid items-center gap-10 py-12 sm:py-20 lg:grid-cols-2">
          <div>
            <Badge tone="blue" className="mb-4 animate-fade-up">
              {t.home.badge}
            </Badge>
            <h1
              className="animate-fade-up text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl"
              style={delay(80)}
            >
              {t.home.title}
            </h1>
            <p
              className="mt-4 animate-fade-up text-lg leading-relaxed text-slate-600"
              style={delay(160)}
            >
              {t.home.lead}
            </p>
            <div
              className="mt-6 flex animate-fade-up flex-wrap gap-3"
              style={delay(240)}
            >
              {user ? (
                <Button href={roleHome(user.role.key)}>{t.home.dashboard}</Button>
              ) : (
                <>
                  <Button href="/register">{t.home.createAccount}</Button>
                  <Button href="/login" variant="outline">
                    {t.home.signIn}
                  </Button>
                  <Button href="/track" variant="ghost">
                    {t.home.track}
                  </Button>
                </>
              )}
              <Button href="/help" variant="ghost">
                {t.home.how}
              </Button>
            </div>
            <dl
              className="mt-8 grid animate-fade-up grid-cols-3 gap-4 border-t border-slate-200 pt-6"
              style={delay(320)}
            >
              {t.home.stats.map((item) => (
                <div key={item.label}>
                  <dt className="text-2xl font-bold text-brand-800">
                    {item.value}
                  </dt>
                  <dd className="mt-1 text-xs leading-snug text-slate-600">
                    {item.label}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="relative animate-scale-in" style={delay(200)}>
            <Image
              src="/images/hero-barangay.jpg"
              alt={t.home.heroAlt}
              width={1600}
              height={900}
              priority
              className="h-auto w-full rounded-2xl border border-slate-200 object-cover shadow-lg"
            />
            <p className="mt-3 text-center text-xs text-slate-500">
              {t.home.heroCaption}
            </p>
          </div>
        </Container>
      </section>

      <section>
        <Container className="py-12 sm:py-16">
          <h2 className="reveal text-2xl font-semibold text-slate-900">
            {t.home.workflowTitle}
          </h2>
          <p className="reveal mt-2 max-w-2xl text-sm text-slate-600">
            {t.home.workflowLead}
          </p>
          <ol className="reveal-stagger mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {t.home.workflow.map((step, index) => {
              const Icon = WORKFLOW_ICONS[step.key as keyof typeof WORKFLOW_ICONS];
              return (
                <li
                  key={step.key}
                  className="rounded-xl border border-slate-200 bg-white p-4 transition-[translate,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md"
                >
                  <span className="inline-flex h-6 items-center rounded-md bg-brand-50 px-2 text-xs font-bold tabular-nums text-brand-700">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <p className="mt-2 flex items-center gap-2 font-semibold text-slate-900">
                    {Icon ? (
                      <Icon
                        size={16}
                        className="text-brand-700"
                        aria-hidden="true"
                      />
                    ) : null}
                    {step.title}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">
                    {step.description}
                  </p>
                </li>
              );
            })}
          </ol>
        </Container>
      </section>

      <section className="border-t border-slate-200 bg-slate-50">
        <Container className="py-12 sm:py-16">
          <h2 className="reveal text-2xl font-semibold text-slate-900">
            {t.home.reportTitle}
          </h2>
          <p className="reveal mt-2 max-w-2xl text-sm text-slate-600">
            {t.home.reportLead}
          </p>
          <div className="reveal-stagger mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {t.home.reportTypes.map((item) => {
              const Icon = REPORT_ICONS[item.key as keyof typeof REPORT_ICONS];
              return (
                <Card
                  key={item.key}
                  className="transition-[translate,box-shadow,border-color] duration-200 hover:-translate-y-1 hover:border-brand-200 hover:shadow-md"
                >
                  <p className="flex items-center gap-2 text-base font-semibold text-slate-900">
                    {Icon ? (
                      <Icon
                        size={18}
                        className="text-brand-700"
                        aria-hidden="true"
                      />
                    ) : null}
                    {item.title}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    {item.description}
                  </p>
                </Card>
              );
            })}
          </div>
        </Container>
      </section>

      <section>
        <Container className="py-12 sm:py-16">
          <h2 className="reveal text-2xl font-semibold text-slate-900">
            {t.home.rolesTitle}
          </h2>
          <div className="reveal-stagger mt-6 grid gap-4 sm:grid-cols-3">
            {t.home.roles.map((role) => {
              const Icon = ROLE_ICONS[role.key as keyof typeof ROLE_ICONS];
              return (
                <Card
                  key={role.key}
                  className="transition-[translate,box-shadow,border-color] duration-200 hover:-translate-y-1 hover:border-brand-200 hover:shadow-md"
                >
                  <p className="flex items-center gap-2 text-base font-semibold text-slate-900">
                    {Icon ? (
                      <Icon
                        size={18}
                        className="text-brand-700"
                        aria-hidden="true"
                      />
                    ) : null}
                    {role.title}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    {role.body}
                  </p>
                </Card>
              );
            })}
          </div>
        </Container>
      </section>

      <section className="border-t border-slate-200 bg-slate-50">
        <Container className="py-12 sm:py-16">
          <div className="reveal flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-slate-900">
                {t.home.faqTitle}
              </h2>
              <p className="mt-2 text-sm text-slate-600">{t.home.faqLead}</p>
            </div>
            <Button href="/help" variant="outline" size="sm">
              {t.home.faqCta}
            </Button>
          </div>
          <div className="reveal mt-6">
            <FaqList items={t.faqs} limit={5} />
          </div>
        </Container>
      </section>

      <section>
        <Container className="py-12 sm:py-16">
          <div className="reveal relative overflow-hidden rounded-2xl bg-brand-800 px-6 py-10 text-white sm:px-10">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-brand-500/40 blur-3xl animate-float-slow"
            />
            <div className="relative">
              <h2 className="text-2xl font-semibold tracking-tight">
                {t.home.ctaTitle}
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-brand-100">
                {t.home.ctaBody}
              </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  {user ? (
                    <Button href={roleHome(user.role.key)} variant="secondary">
                      {t.home.dashboard}
                    </Button>
                  ) : (
                    <>
                      <Button href="/register" variant="secondary">
                        {t.home.ctaCreate}
                      </Button>
                      <Button href="/login" variant="inverse">
                        {t.home.signIn}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
        </Container>
      </section>
    </>
  );
}
