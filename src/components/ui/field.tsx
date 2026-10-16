import { ChevronDown } from "lucide-react";

import { copy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Word marker for required vs optional. Language follows `<html lang>` so
 * every Label does not have to thread a locale prop. `:lang(fil)` matches
 * descendants of `html[lang=fil]`.
 */
export function FieldRequirement({
  required,
  optional,
}: {
  required?: boolean;
  optional?: boolean;
}) {
  if (required) {
    return (
      <span className="inline-flex items-center gap-0.5">
        <span
          aria-label={copy.en.fieldMark.required}
          title={copy.en.fieldMark.required}
          className="text-danger-600"
        >
          *
        </span>
      </span>
    );
  }
  if (optional) {
    return (
      <span className="text-xs font-medium text-ink-subtle">
        <span className="[:lang(fil)]:hidden">{copy.en.fieldMark.optional}</span>
        <span className="hidden [:lang(fil)]:inline">{copy.fil.fieldMark.optional}</span>
      </span>
    );
  }
  return null;
}

export function Label({
  htmlFor,
  required,
  optional,
  children,
}: {
  htmlFor: string;
  /**
   * Renders the mandatory-field marker. Every field the schema requires must
   * set this, and every form shows a legend explaining it.
   */
  required?: boolean;
  /** Renders an Optional marker. Ignored when `required` is set. */
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-sm font-medium text-ink-muted"
    >
      <span>{children}</span>
      <FieldRequirement required={required} optional={optional && !required} />
    </label>
  );
}

/** Legend that explains the Required / Optional markers; place it once per form. */
export function RequiredLegend({ children }: { children?: React.ReactNode }) {
  return (
    <p className="text-caption text-ink-subtle">
      {children ?? (
        <>
          <span className="[:lang(fil)]:hidden">{copy.en.fieldMark.legend}</span>
          <span className="hidden [:lang(fil)]:inline">{copy.fil.fieldMark.legend}</span>
        </>
      )}
    </p>
  );
}

/** Short helper under a control: what to type, or why the field exists. */
export function FieldHint({ children, id }: { children: React.ReactNode; id?: string }) {
  return <p id={id} className="mt-1 text-caption text-ink-subtle">{children}</p>;
}

const controlClass =
  "w-full rounded-control border bg-surface text-sm text-ink placeholder:text-ink-subtle/70 focus:outline-none focus:ring-2 focus:ring-brand-600/30 disabled:bg-surface-muted disabled:text-ink-subtle";

function controlBorder(invalid?: boolean) {
  return invalid
    ? "border-danger-600 focus:border-danger-600"
    : "border-line-strong focus:border-brand-600";
}

export function Input({
  className,
  invalid,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(controlClass, "h-10 px-3", controlBorder(invalid), className)}
      {...props}
    />
  );
}

/**
 * Native select, styled. Native is deliberate: on a phone it opens the
 * platform's own picker, which is faster and more accessible than any custom
 * listbox we could write.
 */
export function Select({
  className,
  invalid,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <div className="relative">
      <select
        aria-invalid={invalid || undefined}
        className={cn(
          controlClass,
          "h-10 appearance-none pr-9 pl-3",
          controlBorder(invalid),
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        size={16}
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-subtle"
      />
    </div>
  );
}

export function Textarea({
  className,
  invalid,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(
        controlClass,
        "px-3 py-2",
        controlBorder(invalid),
        className
      )}
      {...props}
    />
  );
}

export function FieldError({
  id,
  children,
}: {
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <p id={id} role="alert" className="mt-1 text-caption text-danger-600">
      {children}
    </p>
  );
}

export function FormMessage({
  tone,
  children,
}: {
  tone: "error" | "success";
  children: React.ReactNode;
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-control border px-3 py-2 text-sm",
        tone === "error"
          ? "border-danger-100 bg-danger-50 text-danger-700"
          : "border-success-100 bg-success-50 text-success-700"
      )}
    >
      {children}
    </p>
  );
}
