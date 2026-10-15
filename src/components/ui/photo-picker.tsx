"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Camera, Trash2, Upload } from "lucide-react";
import { Label } from "@/components/ui/field";
import { copy, type Locale } from "@/lib/i18n";

const DEFAULT_ACCEPT = "image/jpeg,image/png,image/webp";

/**
 * Pick a photo the way the person in front of the screen would: take it with
 * the camera, or upload an existing file.
 *
 * The picker owns the file in state and mirrors it into a hidden *named*
 * input, so a plain form submission still carries the file under its field
 * name — existing FormData-based submit handlers keep working unchanged.
 * `onChange` notifies the form when it wants to know (previews, validation).
 */
export function PhotoPicker({
  id,
  name,
  label,
  hint,
  required = false,
  accept = DEFAULT_ACCEPT,
  onChange,
  locale = "en",
}: {
  /** The named input's id (and the label's target). */
  id: string;
  /** The form field the file is submitted as; defaults to `id`. */
  name?: string;
  label: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  accept?: string;
  /** Notified with the picked file (or null when removed). */
  onChange?: (file: File | null) => void;
  locale?: Locale;
}) {
  const t = copy[locale].photoPicker;
  const [file, setFile] = useState<File | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const canonicalRef = useRef<HTMLInputElement>(null);

  // The hidden named input is what a FormData(form) read sees, so it must
  // always mirror the current pick — even when the file came from the
  // camera branch (a different input element).
  useEffect(() => {
    const input = canonicalRef.current;
    if (!input) return;
    const transfer = new DataTransfer();
    if (file) transfer.items.add(file);
    input.files = transfer.files;
  }, [file]);

  function pick(next: File | null) {
    setFile(next);
    onChange?.(next);
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-control border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-brand-600"
        >
          <Camera size={16} aria-hidden="true" />
          {t.takePhoto}
        </button>
        <button
          type="button"
          onClick={() => libraryRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-control border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-brand-600"
        >
          <Upload size={16} aria-hidden="true" />
          {t.uploadFile}
        </button>
        {file && (
          <button
            type="button"
            onClick={() => pick(null)}
            aria-label={t.remove}
            className="inline-flex items-center gap-2 rounded-control border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-red-600"
          >
            <Trash2 size={16} aria-hidden="true" />
            {t.remove}
          </button>
        )}
      </div>
      {/* Camera branch: `capture` opens the device camera directly on
          phones; on a desktop the picker falls back to the file dialog. */}
      <input
        ref={cameraRef}
        type="file"
        accept={accept}
        capture="environment"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          pick(event.target.files?.[0] ?? null);
          event.target.value = "";
        }}
      />
      <input
        ref={libraryRef}
        type="file"
        accept={accept}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          pick(event.target.files?.[0] ?? null);
          event.target.value = "";
        }}
      />
      {/* The named input: invisible, but present so native FormData reads
          and native required-validation still see the file. */}
      <input
        ref={canonicalRef}
        id={id}
        name={name ?? id}
        type="file"
        accept={accept}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />
      {file ? (
        <p className="text-xs text-ink-subtle">
          {file.name} · {Math.max(1, Math.ceil(file.size / 1024))} KB
        </p>
      ) : (
        hint !== undefined && (
          <p className="text-xs text-ink-subtle">{hint}</p>
        )
      )}
    </div>
  );
}
