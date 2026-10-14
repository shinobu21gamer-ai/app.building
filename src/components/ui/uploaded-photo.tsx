"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Expand, ImageOff, RotateCw, X } from "lucide-react";
import { copy, type Locale } from "@/lib/i18n";

/** Private photos must load directly with the browser's session cookie, never
 * through the Next image optimizer (its server request has no user session). */
export function UploadedPhoto(props: { src: string; alt: string; locale?: Locale }) {
  // A changed source starts with a fresh load/error state.
  return <Photo key={props.src} {...props} />;
}

function Photo({ src, alt, locale = "en" }: { src: string; alt: string; locale?: Locale }) {
  const t = copy[locale].photoViewer;
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [expandedFailed, setExpandedFailed] = useState(false);
  const [expandedAttempt, setExpandedAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  function retry() {
    setFailed(false);
    setAttempt((value) => value + 1);
  }

  return (
    <div className="space-y-2">
      <div className="max-h-80 overflow-auto overscroll-contain rounded-xl border border-line bg-surface-sunken p-2">
        {failed ? (
          <div role="status" className="flex flex-col items-center gap-3 p-6 text-center text-sm text-ink-muted">
            <ImageOff size={28} aria-hidden="true" />
            <p>{t.unavailable}</p>
            <button type="button" onClick={retry} className="tap-target inline-flex items-center gap-2 rounded-control border border-line-strong px-3 font-medium hover:bg-surface focus-visible:outline-2 focus-visible:outline-brand-600">
              <RotateCw size={16} aria-hidden="true" />{t.retry}
            </button>
          </div>
        ) : (
          <Image key={attempt} src={src} alt={alt} width={800} height={600}
            unoptimized onError={() => setFailed(true)}
            className="h-auto w-full rounded-lg object-contain" />
        )}
      </div>
      {!failed && (
        <button type="button" onClick={() => {
          setExpandedFailed(false);
          dialog.current?.showModal();
          setOpen(true);
        }} className="tap-target inline-flex items-center gap-2 rounded-control px-2 text-sm font-medium text-brand-700 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-600">
          <Expand size={16} aria-hidden="true" />{t.open}
        </button>
      )}
      {/* Native modal supplies focus trapping, Escape, and focus restoration. */}
      <dialog ref={dialog} aria-label={alt} onClose={() => setOpen(false)}
        className="m-auto w-[calc(100%_-_2rem)] max-w-5xl max-h-[90dvh] rounded-xl border border-line bg-surface p-0 text-ink shadow-raised backdrop:bg-black/60">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <p className="text-sm">{t.scrollHint}</p>
          <button type="button" autoFocus onClick={() => dialog.current?.close()}
            aria-label={t.close} className="tap-target inline-flex w-11 shrink-0 items-center justify-center rounded-control hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-brand-600">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        {open && (expandedFailed ? (
          <div role="status" className="space-y-3 p-6 text-sm">
            <p>{t.unavailable}</p>
            <button type="button" onClick={() => {
              setExpandedFailed(false);
              setExpandedAttempt((value) => value + 1);
            }} className="tap-target rounded-control border border-line px-3">{t.retry}</button>
          </div>
        ) : (
          <div tabIndex={0} role="region" aria-label={alt}
            className="max-h-[70dvh] overflow-auto overscroll-contain bg-surface-sunken p-3 focus-visible:outline-2 focus-visible:outline-brand-600">
            {/* Natural dimensions; scroll rather than crop large proof photos. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img key={expandedAttempt} src={src} alt={alt} onError={() => setExpandedFailed(true)}
              className="mx-auto block max-w-none" />
          </div>
        ))}
      </dialog>
    </div>
  );
}
