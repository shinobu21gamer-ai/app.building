"use client";

import { useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { copy, type Locale } from "@/lib/i18n";
import type { ProcessStepKey, ProcessStepState } from "@/lib/cases/process-flow";

export type FlowStepView = {
  key: ProcessStepKey;
  number: number;
  state: ProcessStepState;
  title: string;
  lead: string;
  todo: string[];
  /** Who owns the step, already resolved into words ("Your office", "Treasury office"). */
  desk: string;
  /** Why the step cannot be worked on yet, in words. Null when it can. */
  block: string | null;
};

const DOT_STATE: Record<ProcessStepState, string> = {
  done: "border-brand-600 bg-brand-600 text-white",
  current: "border-brand-600 bg-surface text-brand-700 ring-4 ring-brand-100",
  pending: "border-line-strong bg-surface text-ink-faint",
  skipped: "border-line bg-surface-sunken text-ink-faint",
};

const CHIP_STATE: Record<ProcessStepState, string> = {
  done: "border-line bg-surface text-ink",
  current: "border-brand-600 bg-brand-50 text-brand-900 ring-1 ring-brand-200",
  pending: "border-line bg-surface text-ink-faint",
  skipped: "border-line bg-surface-sunken text-ink-faint",
};

/**
 * The step-by-step case flow: the numbered rail, the step being worked on, and
 * the form that does that step's work.
 *
 * The rail is horizontal so the work below it gets the full width of the page —
 * the forms used to be stacked in a narrow right-hand column, which is exactly
 * what made "what do I do next?" hard to answer. Every step's instructions are
 * one click away; the desk that owns a step is named on the card, so a worker
 * never wonders whether a missing step is theirs or the treasury's.
 */
export function ProcessFlowPanel({
  locale = "en",
  steps,
  currentKey,
  doneCount,
  activeTotal,
  percent,
  finished,
  panels = {},
}: {
  locale?: Locale;
  steps: FlowStepView[];
  currentKey: ProcessStepKey | null;
  doneCount: number;
  activeTotal: number;
  percent: number;
  finished: boolean;
  /** The form that does each step's work, keyed by step. */
  panels?: Partial<Record<ProcessStepKey, ReactNode>>;
}) {
  const t = copy[locale].flow;
  // Follow the case: when a submission moves the case to the next step, the
  // panel opens that step. A manual choice wins until the case moves again.
  const [picked, setPicked] = useState<ProcessStepKey | null>(null);
  const [lastCurrent, setLastCurrent] = useState(currentKey);
  if (currentKey !== lastCurrent) {
    setLastCurrent(currentKey);
    setPicked(null);
  }

  const openKey = picked ?? currentKey ?? steps[steps.length - 1]?.key ?? null;
  const active = steps.find((step) => step.key === openKey) ?? null;
  const nextStep =
    active && active.state !== "done"
      ? steps.find((step) => step.number > active.number)
      : null;
  // The step being worked on now. A step the reader clicked ahead to cannot be
  // acted on until this one is finished, so the note says which one that is.
  const currentStep = steps.find((step) => step.state === "current") ?? null;
  const earlierUnfinished =
    active && currentStep && active.number > currentStep.number
      ? currentStep
      : null;

  const stateLabel: Record<ProcessStepState, string> = {
    done: t.doneBadge,
    current: t.currentBadge,
    pending: t.laterBadge,
    skipped: t.skippedBadge,
  };

  return (
    <section
      className="rounded-card border border-line bg-surface shadow-card"
      aria-label={t.title}
    >
      <div className="space-y-3 px-4 pt-4 sm:px-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-caption font-semibold uppercase tracking-wide text-ink-subtle">
              {t.title}
            </p>
            <h2 className="text-subtitle text-ink">
              {t.stepOf
                .replace("{current}", String(active?.number ?? steps.length))
                .replace("{total}", String(steps.length))}
              {active ? ` · ${active.title}` : ""}
            </h2>
          </div>
          <p className="text-sm text-ink-subtle">
            {t.progress
              .replace("{done}", String(doneCount))
              .replace("{total}", String(activeTotal))}
          </p>
        </div>

        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
          <div
            className="h-full rounded-full bg-brand-600 transition-[width] duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>

        {/* Eight steps do not fit on a phone, so the rail scrolls sideways
            there; from `sm` up they wrap, because a hidden step is a step
            somebody forgets. */}
        <ol className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
          {steps.map((step) => {
            const isOpen = step.key === openKey;
            return (
              <li key={step.key} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setPicked(step.key)}
                  aria-current={step.state === "current" ? "step" : undefined}
                  className={cn(
                    "flex w-full min-w-[9.5rem] items-center gap-2 rounded-control border px-2.5 py-2 text-left transition-colors",
                    CHIP_STATE[step.state],
                    isOpen ? "shadow-card" : "hover:bg-surface-muted"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                      DOT_STATE[step.state]
                    )}
                  >
                    {step.state === "done" ? (
                      <Check size={13} aria-hidden="true" />
                    ) : (
                      step.number
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold">
                      {step.title}
                    </span>
                    <span className="block text-[11px] text-ink-subtle">
                      {stateLabel[step.state]}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="border-t border-line px-4 py-5 sm:px-5">
        {finished || !active ? (
          <p className="rounded-control border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {t.closedNote}
          </p>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-8">
            <div className="space-y-3">
              <div>
                <p className="text-caption font-semibold uppercase tracking-wide text-ink-subtle">
                  {active.state === "current" ? t.currentStep : stateLabel[active.state]} ·{" "}
                  {t.stepOf
                    .replace("{current}", String(active.number))
                    .replace("{total}", String(steps.length))}
                </p>
                <h3 className="text-subtitle text-ink">{active.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                  {active.lead}
                </p>
              </div>

              <dl className="rounded-control border border-line bg-surface-sunken px-3 py-2 text-sm">
                <dt className="text-caption font-semibold uppercase tracking-wide text-ink-subtle">
                  {t.whoDoesIt}
                </dt>
                <dd className="text-ink">{active.desk}</dd>
              </dl>

              <div>
                <p className="text-sm font-semibold text-ink">{t.whatToDo}</p>
                <ul className="mt-1.5 space-y-1.5">
                  {active.todo.map((line) => (
                    <li
                      key={line}
                      className="flex gap-2 text-sm leading-relaxed text-ink-muted"
                    >
                      <span
                        aria-hidden="true"
                        className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500"
                      />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {nextStep && active.state === "current" ? (
                <p className="text-xs text-ink-subtle">
                  {t.nextUp.replace("{title}", `${nextStep.number}. ${nextStep.title}`)}
                </p>
              ) : null}
            </div>

            <div className="min-w-0">
              {panels[active.key] ? (
                panels[active.key]
              ) : (
                <p className="rounded-control border border-dashed border-line bg-surface-sunken px-3 py-3 text-sm text-ink-muted">
                  {active.state === "skipped"
                    ? t.skippedNote
                    : earlierUnfinished
                      ? t.finishEarlier.replace(
                          "{number}",
                          String(earlierUnfinished.number)
                        )
                      : active.block
                        ? active.block
                        : t.otherDesk.replace("{desk}", active.desk)}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
