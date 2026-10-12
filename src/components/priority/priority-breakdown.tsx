import { Badge, PriorityBadge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import { copy, type Locale } from "@/lib/i18n";
import type { PriorityEvaluation } from "@/lib/priority/engine";

export function parseEvaluation(
  calculationJson: string | null
): PriorityEvaluation | null {
  if (!calculationJson) return null;
  try {
    return JSON.parse(calculationJson) as PriorityEvaluation;
  } catch {
    return null;
  }
}

export function PriorityBreakdown({
  level,
  totalScore,
  evaluation,
  isOverride,
  overrideReason,
  assessorName,
  createdAt,
  locale = "en",
}: {
  level: string;
  totalScore: number;
  evaluation: PriorityEvaluation | null;
  isOverride: boolean;
  overrideReason?: string | null;
  assessorName?: string | null;
  createdAt: Date;
  locale?: Locale;
}) {
  const t = copy[locale].desk;
  const date = formatDateTime(createdAt);
  const footer = isOverride
    ? assessorName
      ? t.overriddenBy.replace("{name}", assessorName).replace("{date}", date)
      : t.overriddenAuto.replace("{date}", date)
    : assessorName
      ? t.assessedBy.replace("{name}", assessorName).replace("{date}", date)
      : t.assessedAuto.replace("{date}", date);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <PriorityBadge level={level} />
        <span className="text-sm text-ink-muted">
          {t.totalScore}{" "}
          <span className="font-semibold text-ink">{totalScore}</span>
        </span>
        {isOverride ? (
          <Badge tone="amber">{t.officialOverride}</Badge>
        ) : (
          <Badge tone="sky">{t.automatedAssessment}</Badge>
        )}
      </div>

      {evaluation && evaluation.factors.length > 0 && (
        <table className="w-full text-sm">
          <caption className="sr-only">{t.howComputed}</caption>
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-subtle">
              <th scope="col" className="py-1.5 pr-3 text-left font-semibold">
                {t.factor}
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                {t.score}
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                {t.weight}
              </th>
              <th scope="col" className="py-1.5 text-right font-semibold">
                {t.weighted}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {evaluation.factors.map((factor) => (
              <tr key={factor.key}>
                <td className="py-1.5 pr-3 text-ink-muted">{factor.label}</td>
                <td className="py-1.5 pr-3 text-right text-ink-muted">
                  {factor.score}
                </td>
                <td className="py-1.5 pr-3 text-right text-ink-muted">
                  {factor.weight}
                </td>
                <td className="py-1.5 text-right font-medium text-ink">
                  {factor.weightedScore}
                </td>
              </tr>
            ))}
            <tr>
              <td
                className="pt-2 text-right font-semibold text-ink"
                colSpan={3}
              >
                {t.total}
              </td>
              <td className="pt-2 text-right font-bold text-ink">
                {totalScore}
              </td>
            </tr>
          </tbody>
        </table>
      )}

      {evaluation && (
        <div className="rounded-control bg-surface-muted p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            {t.howComputed}
          </p>
          <ul className="mt-1.5 space-y-0.5 text-xs text-ink-muted">
            {evaluation.explanation.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {isOverride && overrideReason && (
        <p className="text-sm text-ink-muted">
          <span className="font-medium text-ink">
            {t.overrideReasonLabel}
          </span>{" "}
          {overrideReason}
        </p>
      )}

      <p className="text-xs text-slate-400">{footer}</p>
    </div>
  );
}
