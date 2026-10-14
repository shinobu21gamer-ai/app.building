import { AlertTriangle, MapPin, ShieldCheck } from "lucide-react";
import { copy, type Locale } from "@/lib/i18n";

export function ReportingGuide({ locale }: { locale: Locale }) {
  const t = copy[locale].reportingExperience;
  const emergency = copy[locale].emergency;
  return <aside className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
    <div className="flex items-start gap-2">
      <AlertTriangle className="mt-0.5 shrink-0 text-amber-700" size={18} aria-hidden="true" />
      <div><p className="font-semibold text-amber-950">{emergency.heading}</p><p className="mt-1 leading-6 text-amber-900">{emergency.body}</p></div>
    </div>
    <ul className="space-y-2 border-t border-amber-200 pt-3 text-ink-muted">
      <li className="flex gap-2"><MapPin size={16} aria-hidden="true" className="mt-0.5 shrink-0" />{t.locationHint}</li>
      <li className="flex gap-2"><ShieldCheck size={16} aria-hidden="true" className="mt-0.5 shrink-0" />{t.privacyHint}</li>
    </ul>
  </aside>;
}
