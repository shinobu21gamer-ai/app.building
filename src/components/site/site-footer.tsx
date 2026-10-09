import Link from "next/link";
import { Phone } from "lucide-react";
import { Container } from "@/components/ui/container";
import { copy, type Locale } from "@/lib/i18n";

export function SiteFooter({ locale }: { locale: Locale }) {
  const t = copy[locale];
  const columns = [
    {
      title: t.footer.residents,
      links: [
        { href: "/register", label: t.footer.createAccount },
        { href: "/login", label: t.footer.signIn },
        { href: "/track", label: t.footer.track },
        { href: "/help", label: t.footer.help },
      ],
    },
    {
      title: t.footer.about,
      links: [
        { href: "/", label: t.footer.home },
        { href: "/privacy", label: t.footer.privacy },
        { href: "/help#emergencies", label: t.footer.emergencies },
      ],
    },
  ];

  return (
    <footer className="no-print border-t border-slate-200 bg-slate-50">
      <Container className="py-10">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-2">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-700 text-sm font-bold text-white">
                BR
              </span>
              BarangayResolve
            </p>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-600">
              {t.footer.blurb}
            </p>
            <div className="mt-4 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950">
              <Phone size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <p className="text-xs leading-relaxed">
                <span className="font-semibold">{t.emergency.heading}.</span>{" "}
                {t.emergency.body}
              </p>
            </div>
          </div>

          {columns.map((column) => (
            <div key={column.title}>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {column.title}
              </p>
              <ul className="mt-3 space-y-2">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-slate-700 hover:text-brand-800"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-col gap-2 border-t border-slate-200 pt-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>{t.footer.credit}</p>
          <p>{t.footer.not911}</p>
        </div>
      </Container>
    </footer>
  );
}
