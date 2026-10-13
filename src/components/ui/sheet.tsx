"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A bottom sheet: the mobile counterpart of a dialog. It slides up from the
 * bottom of the screen so the reachable area of a phone stays usable, closes
 * on Escape, on the backdrop, and returns focus to the page when it unmounts.
 *
 * Rendered inline (no portal) because the shell it serves is already at the
 * end of the layout; `fixed` positioning keeps it above page content anyway.
 */
export function Sheet({
  open,
  onClose,
  title,
  closeLabel,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
  children: React.ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="no-print fixed inset-0 z-50 md:hidden">
      <button
        type="button"
        aria-label={closeLabel}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-ink/40"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "animate-drop-in absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto overscroll-contain",
          "rounded-t-2xl border-t border-line bg-surface pb-[env(safe-area-inset-bottom,0px)] shadow-raised",
          className
        )}
      >
        <div className="sticky top-0 flex items-center justify-between gap-4 border-b border-line bg-surface px-4 py-3">
          <p className="text-sm font-semibold text-ink">{title}</p>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-control text-ink-muted hover:bg-surface-sunken"
          >
            <X size={18} aria-hidden="true" />
            <span className="sr-only">{closeLabel}</span>
          </button>
        </div>
        <div className="px-3 py-3">{children}</div>
      </div>
    </div>
  );
}
