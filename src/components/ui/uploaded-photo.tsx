"use client";

import { useEffect, useRef, useState } from "react";
import { Expand, ImageOff, RotateCw, X } from "lucide-react";
import { copy, type Locale } from "@/lib/i18n";

/**
 * Private proof photos live behind the session cookie. Next's image optimizer
 * fetches without that cookie, so this loads the bytes with `fetch` (credentials
 * included) and shows a blob URL — the same cookie the rest of the app already
 * sent to open the page.
 */
export function UploadedPhoto(props: { src: string; alt: string; locale?: Locale }) {
  return <Photo key={`${props.src}:${props.locale ?? "en"}`} {...props} />;
}

function Photo({ src, alt, locale = "en" }: { src: string; alt: string; locale?: Locale }) {
  const t = copy[locale].photoViewer;
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [displaySrc, setDisplaySrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setFailed(false);
    setDisplaySrc(null);

    async function load() {
      try {
        const response = await fetch(src, { credentials: "include", cache: "no-store" });
        if (!response.ok) throw new Error("unavailable");
        const blob = await response.blob();
        if (!blob.type.startsWith("image/")) throw new Error("unavailable");
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setDisplaySrc(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, attempt]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  function retry() {
    setFailed(false);
    setAttempt((value) => value + 1);
  }

  return (
    <div className="space-y-2">
      <div className="max-h-80 overflow-auto overscroll-contain rounded-xl border border-line bg-surface-sunken p-2">
        {failed ? (
          <div
            role="status"
            className="flex flex-col items-center gap-3 p-6 text-center text-sm text-ink-muted"
          >
            <ImageOff size={28} aria-hidden="true" />
            <p>{t.unavailable}</p>
            <button
              type="button"
              onClick={retry}
              className="tap-target inline-flex items-center gap-2 rounded-control border border-line-strong px-3 font-medium hover:bg-surface focus-visible:outline-2 focus-visible:outline-brand-600"
            >
              <RotateCw size={16} aria-hidden="true" />
              {t.retry}
            </button>
          </div>
        ) : displaySrc ? (
          // Natural size inside a scroll box; do not crop proof photos.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={displaySrc} alt={alt} className="h-auto w-full rounded-lg object-contain" />
        ) : (
          <p className="p-6 text-center text-sm text-ink-muted">{t.loading}</p>
        )}
      </div>
      {!failed && displaySrc && (
        <button
          type="button"
          onClick={() => {
            dialog.current?.showModal();
            setOpen(true);
          }}
          className="tap-target inline-flex items-center gap-2 rounded-control px-2 text-sm font-medium text-brand-700 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-600"
        >
          <Expand size={16} aria-hidden="true" />
          {t.open}
        </button>
      )}
      <dialog
        ref={dialog}
        aria-label={alt}
        onClose={() => setOpen(false)}
        className="m-auto w-[calc(100%_-_2rem)] max-h-[90dvh] max-w-5xl rounded-xl border border-line bg-surface p-0 text-ink shadow-raised backdrop:bg-black/60"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <p className="text-sm">{t.scrollHint}</p>
          <button
            type="button"
            autoFocus
            onClick={() => dialog.current?.close()}
            aria-label={t.close}
            className="tap-target inline-flex w-11 shrink-0 items-center justify-center rounded-control hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        {open && displaySrc ? (
          <div
            tabIndex={0}
            role="region"
            aria-label={alt}
            className="max-h-[70dvh] overflow-auto overscroll-contain bg-surface-sunken p-3 focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={displaySrc} alt={alt} className="mx-auto block max-w-none" />
          </div>
        ) : null}
      </dialog>
    </div>
  );
}
