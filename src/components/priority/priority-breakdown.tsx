import { Badge, PriorityBadge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
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
}: {
  level: string;
  totalScore: number;
  evaluation: PriorityEvaluation | null;
  isOverride: boolean;
  overrideReason?: string | null;
  assessorName?: string | null;
  createdAt: Date;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <PriorityBadge level={level} />
        <span className="text-sm text-slate-600">
          Total score:{" "}
          <span className="font-semibold text-slate-900">{totalScore}</span>
        </span>
        {isOverride ? (
          <Badge tone="amber">Official override</Badge>
        ) : (
          <Badge tone="sky">Automated assessment</Badge>
        )}
      </div>

      {evaluation && evaluation.factors.length > 0 && (
        <table className="w-full text-sm">
          <caption className="sr-only">Priority factor breakdown</caption>
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th scope="col" className="py-1.5 pr-3 text-left font-semibold">
                Factor
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                Score
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                Weight
              </th>
              <th scope="col" className="py-1.5 text-right font-semibold">
                Weighted
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {evaluation.factors.map((factor) => (
              <tr key={factor.key}>
                <td className="py-1.5 pr-3 text-slate-700">{factor.label}</td>
                <td className="py-1.5 pr-3 text-right text-slate-700">
                  {factor.score}
                </td>
                <td className="py-1.5 pr-3 text-right text-slate-700">
                  {factor.weight}
                </td>
                <td className="py-1.5 text-right font-medium text-slate-900">
                  {factor.weightedScore}
                </td>
              </tr>
            ))}
            <tr>
              <td
                className="pt-2 text-right font-semibold text-slate-900"
                colSpan={3}
              >
                Total
              </td>
              <td className="pt-2 text-right font-bold text-slate-900">
                {totalScore}
              </td>
            </tr>
          </tbody>
        </table>
      )}

      {evaluation && (
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            How this score was computed
          </p>
          <ul className="mt-1.5 space-y-0.5 text-xs text-slate-600">
            {evaluation.explanation.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {isOverride && overrideReason && (
        <p className="text-sm text-slate-600">
          <span className="font-medium text-slate-900">Override reason:</span>{" "}
          {overrideReason}
        </p>
      )}

      <p className="text-xs text-slate-400">
        {isOverride ? "Overridden" : "Assessed"}
        {assessorName ? ` by ${assessorName}` : " automatically by the system"} on{" "}
        {formatDateTime(createdAt)}
      </p>
    </div>
  );
}
