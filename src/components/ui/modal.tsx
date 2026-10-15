"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const SIZE_CLASS = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-3xl",
} as const;

export type ModalSize = keyof typeof SIZE_CLASS;

/**
 * A centred dialog for the admin desks.
 *
 * Every "Add ..." form on the admin screens lives behind a button instead of
 * sitting open above the data: the list stays the first thing on the page and
 * the form only exists while it is being filled in. This is the shell that
 * holds those forms.
 *
 * Same keyboard contract as `Sheet` (the phone-sized sibling): Escape and the
 * backdrop close it, Tab is trapped inside the panel, the page behind cannot
 * scroll, and focus returns to whatever opened it. Rendering is inline (no
 * portal) because the desks render it at the end of their own subtree, and
 * `fixed` positioning keeps it above page content regardless.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
  closeLabel = "Close",
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  size?: ModalSize;
  closeLabel?: string;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();

    function focusableElements(): HTMLElement[] {
      const panel = panelRef.current;
      if (!panel) return [];
      return Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusableElements();
      if (elements.length === 0) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || active === panelRef.current) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
      previouslyFocused?.focus();
    };
    // Only when the dialog opens or closes. `onClose` is read from a ref so a
    // parent re-render (each keystroke in the form) cannot remount this trap
    // and steal focus after one letter.
  }, [open]);

  if (!open) return null;

  return (
    <div className="no-print fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <button
        type="button"
        aria-label={closeLabel}
        onClick={onClose}
        className="fixed inset-0 h-full w-full cursor-default bg-ink/50"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          "animate-drop-in relative my-auto w-full rounded-card border border-line bg-surface shadow-raised",
          SIZE_CLASS[size],
          className
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-subtitle text-ink">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-0.5 text-sm leading-relaxed text-ink-subtle">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-surface-sunken"
          >
            <X size={18} aria-hidden="true" />
            <span className="sr-only">{closeLabel}</span>
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          {children}
        </div>
      </div>
    </div>
  );
}
