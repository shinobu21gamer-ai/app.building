"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StepGuide, type GuideStep } from "@/components/cases/step-guide";

/**
 * First-day orientation for a desk. Numbered steps, what to do when something
 * looks wrong, and a link to the full help page. Hidden after the reader
 * dismisses it (remembered on this device) so it does not nag returning staff.
 */
export function DeskGuide({
  title,
  lead,
  steps,
  mistakesTitle,
  mistakes,
  helpHref = "/help",
  helpLabel,
  hideLabel,
  showLabel,
  storageKey,
  defaultOpen = true,
}: {
  title: string;
  lead: string;
  steps: GuideStep[];
  mistakesTitle: string;
  mistakes: string;
  helpHref?: string;
  helpLabel: string;
  hideLabel: string;
  showLabel: string;
  storageKey: string;
  /** When the desk already has work, start collapsed so the queue is first. */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === "hidden") setOpen(false);
      else if (stored === "open") setOpen(true);
    } catch {
      // Storage can be blocked; keep defaultOpen.
    }
  }, [storageKey]);

  function persist(next: boolean) {
    setOpen(next);
    try {
      window.localStorage.setItem(storageKey, next ? "open" : "hidden");
    } catch {
      // Ignore.
    }
  }

  if (!open) {
    return (
      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => persist(true)}>
          {showLabel}
        </Button>
      </div>
    );
  }

  return (
    <Card title={title} description={lead}>
      <StepGuide steps={steps} />
      <div className="mt-4 rounded-control border border-amber-200 bg-amber-50 px-3 py-2.5">
        <p className="text-sm font-semibold text-amber-950">{mistakesTitle}</p>
        <p className="mt-1 text-sm leading-relaxed text-amber-900">{mistakes}</p>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button href={helpHref} size="sm" variant="outline">
          {helpLabel}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => persist(false)}>
          {hideLabel}
        </Button>
      </div>
    </Card>
  );
}
