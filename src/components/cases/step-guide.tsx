import { cn } from "@/lib/utils";

export type GuideStep = {
  title: string;
  detail?: string;
  /** Marks the step the reader is on right now. */
  highlight?: boolean;
  /** A one-word state shown next to the title ("Done", "Now"). */
  stateLabel?: string;
};

/**
 * A compact numbered list of the steps of a job — the crew-facing twin of
 * `ProcessFlowPanel`. It carries no forms: it exists so a crew member (or an
 * admin scanning the validation queue) can read the order of work in one glance
 * instead of inferring it from a status badge.
 */
export function StepGuide({
  title,
  lead,
  steps,
  className,
}: {
  title?: string;
  lead?: string;
  steps: GuideStep[];
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      {(title || lead) && (
        <div>
          {title && <h3 className="text-sm font-semibold text-ink">{title}</h3>}
          {lead && (
            <p className="mt-0.5 text-xs leading-relaxed text-ink-subtle">
              {lead}
            </p>
          )}
        </div>
      )}

      <ol className="space-y-2">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                step.highlight
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-line-strong bg-surface text-ink-subtle"
              )}
            >
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">
                {step.title}
                {step.stateLabel ? (
                  <span
                    className={cn(
                      "ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      step.highlight
                        ? "bg-brand-50 text-brand-800"
                        : "bg-surface-sunken text-ink-subtle"
                    )}
                  >
                    {step.stateLabel}
                  </span>
                ) : null}
              </p>
              {step.detail && (
                <p className="mt-0.5 text-xs leading-relaxed text-ink-subtle">
                  {step.detail}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
