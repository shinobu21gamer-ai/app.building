"use client";

import { useState, type ReactNode } from "react";
import { Check, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  /** Short owner on the rail (Admin, Official, Captain). */
  owner: string;
  /** Full who-does-this sentence on the card. */
  who: string;
  /** Named desk for the "the X handles this" fallback. */
  desk: string;
  /** Why the step cannot be worked on yet, in words. Null when it can. */
  block: string | null;
  /** This account's role is the desk that works the step. */
  ownsStep?: boolean;
  /** The signed-in person should act on the current step right now. */
  yourTurn?: boolean;
  /** Person waiting on, when the case is assigned to someone by name. */
  waitingName?: string | null;
};

const DOT_STATE: Record<ProcessStepState, string> = {
  done: "border-brand-600 bg-brand-600 text-white",
  current: "border-brand-600 bg-surface text-brand-700 ring-4 ring-brand-100",
  pending: "border-line-strong bg-surface text-ink-faint",
  // A step the case closed before reaching: it is not "coming", so it reads
  // back rather than forward.
  notNeeded: "border-line bg-surface-sunken text-ink-faint",
};

const CHIP_STATE: Record<ProcessStepState, string> = {
  done: "border-line bg-surface text-ink",
  current: "border-brand-600 bg-brand-50 text-brand-900 ring-1 ring-brand-200",
  pending: "border-line bg-surface text-ink-faint",
  notNeeded: "border-dashed border-line bg-surface-sunken text-ink-subtle",
};

/**
 * The step-by-step case flow: the numbered rail, the step being worked on, and
 * the form that does that step's work.
 *
 * The current-step card answers "is this me?" first — Your turn, or Not you —
 * so an admin who already validated is not left reading "save the assessment"
 * as if it were their form.
 */
export function ProcessFlowPanel({
  locale = "en",
  steps,
  currentKey,
  doneCount,
  activeTotal,
  percent,
  finished,
  unfounded = false,
  leaveHref,
  leaveLabel,
  panels = {},
}: {
  locale?: Locale;
  steps: FlowStepView[];
  currentKey: ProcessStepKey | null;
  doneCount: number;
  activeTotal: number;
  percent: number;
  finished: boolean;
  /**
   * The case was closed without ever doing the work, because the field check
   * did not confirm the report (`closeAsUnfounded`). The closing note says so
   * instead of telling the reader every step was worked.
   */
  unfounded?: boolean;
  /** Where to go when this step is not yours (queue, desk). */
  leaveHref?: string;
  leaveLabel?: string;
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
    notNeeded: t.notNeededBadge,
  };

  const owns = Boolean(active?.ownsStep);
  const yoursNow = Boolean(active && active.state === "current" && active.yourTurn);
  const yoursLater = Boolean(active && active.state === "pending" && owns);
  const yoursDone = Boolean(active && active.state === "done" && owns);
  const notYours = Boolean(active && !owns && active.state !== "notNeeded");
  const notYoursNow = Boolean(notYours && active?.state === "current");

  function waitingCopy(step: FlowStepView): string {
    if (step.waitingName) {
      return t.waitingPerson
        .replace("{name}", step.waitingName)
        .replace("{desk}", step.desk);
    }
    return t.waitingOn.replace("{desk}", step.desk);
  }

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
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-muted">
              {t.lead}
            </p>
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

        {/* Nine steps do not fit on a phone, so the rail scrolls sideways
            there; from `sm` up they wrap, because a hidden step is a step
            somebody forgets. */}
        <ol className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
          {steps.map((step) => {
            const isOpen = step.key === openKey;
            const chipStatus =
              step.state === "current" && step.yourTurn
                ? t.yourTurn
                : step.state === "current" && !step.ownsStep
                  ? t.waitingBadge
                  : step.state === "pending" && step.ownsStep
                    ? t.yoursLater
                    : stateLabel[step.state];
            return (
              <li key={step.key} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setPicked(step.key)}
                  aria-current={step.state === "current" ? "step" : undefined}
                  className={cn(
                    "flex w-full min-w-[11rem] items-center gap-2 rounded-control border px-2.5 py-2 text-left transition-colors",
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
                    ) : step.state === "notNeeded" ? (
                      <Minus size={13} aria-hidden="true" />
                    ) : (
                      step.number
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold">
                      {step.title}
                    </span>
                    <span className="block text-[11px] text-ink-subtle">
                      {chipStatus} ·{" "}
                      {step.yourTurn || (step.ownsStep && step.state !== "current")
                        ? t.deskYou
                        : step.owner}
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
            {unfounded ? t.unfoundedNote : t.closedNote}
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

              <div
                className={cn(
                  "rounded-control border px-3 py-2.5 text-sm",
                  yoursNow
                    ? "border-brand-200 bg-brand-50"
                    : notYours
                      ? "border-amber-200 bg-amber-50"
                      : "border-line bg-surface-sunken"
                )}
              >
                <p className="text-caption font-semibold uppercase tracking-wide text-ink-subtle">
                  {t.whoDoesIt}
                </p>
                <p
                  className={cn(
                    "mt-0.5 text-base font-semibold",
                    yoursNow || yoursLater || yoursDone
                      ? "text-brand-800"
                      : notYours
                        ? "text-amber-900"
                        : "text-ink"
                  )}
                >
                  {yoursNow
                    ? t.youDoThis
                    : yoursLater
                      ? t.yoursLater
                      : yoursDone
                        ? t.yoursDone
                        : notYours
                          ? t.notYouTitle
                          : active.owner}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-ink">
                  {notYours && active.state === "current"
                    ? waitingCopy(active)
                    : active.who}
                </p>
                {notYoursNow ? (
                  <p className="mt-2 text-sm text-ink-muted">
                    {t.yourPartDone.replace("{desk}", active.desk)}
                  </p>
                ) : null}
                {yoursNow ? (
                  <p className="mt-2 text-sm text-ink-muted">{t.doThisBelow}</p>
                ) : null}
                {yoursLater && earlierUnfinished ? (
                  <p className="mt-2 text-sm text-ink-muted">
                    {t.laterYoursHint.replace("{number}", String(earlierUnfinished.number))}
                  </p>
                ) : null}
              </div>

              {yoursNow ? (
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
              ) : null}

              {nextStep && active.state === "current" ? (
                <p className="text-xs text-ink-subtle">
                  {t.nextUp.replace("{title}", `${nextStep.number}. ${nextStep.title}`)}
                </p>
              ) : null}
            </div>

            <div className="min-w-0">
              {panels[active.key] &&
              !earlierUnfinished &&
              (active.state === "current" || active.state === "done") ? (
                panels[active.key]
              ) : (
                <div className="space-y-3 rounded-control border border-dashed border-line bg-surface-sunken px-3 py-3 text-sm text-ink-muted">
                  <p>
                    {active.state === "notNeeded"
                      ? t.notNeededHint
                      : notYours
                        ? t.waitingHint
                        : earlierUnfinished
                          ? t.laterYoursHint.replace(
                              "{number}",
                              String(earlierUnfinished.number)
                            )
                          : active.block && owns
                            ? active.block
                            : active.state === "done"
                              ? t.doneBadge
                              : t.otherDesk.replace("{desk}", active.desk)}
                  </p>
                  {notYoursNow && leaveHref ? (
                    <Button href={leaveHref} size="sm">
                      {leaveLabel ?? t.leaveCase}
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
