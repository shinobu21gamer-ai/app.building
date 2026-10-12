import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "destructive"
  | "inverse";
type Size = "sm" | "md" | "lg";

const baseStyles =
  "inline-flex items-center justify-center gap-2 rounded-control font-semibold transition-[background-color,color,border-color,box-shadow,transform] duration-150 ease-out hover:-translate-y-0.5 hover:shadow-sm active:translate-y-0 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:transform-none disabled:shadow-none";

const variantStyles: Record<Variant, string> = {
  primary:
    "bg-brand-700 text-white hover:bg-brand-800 focus-visible:outline-brand-700",
  secondary:
    "bg-brand-50 text-brand-800 hover:bg-brand-100 focus-visible:outline-brand-700",
  outline:
    "border border-line-strong bg-surface text-ink-muted hover:bg-surface-muted hover:text-ink focus-visible:outline-slate-400",
  ghost: "text-ink-muted hover:bg-surface-sunken hover:text-ink",
  destructive:
    "bg-danger-600 text-white hover:bg-danger-700 focus-visible:outline-danger-600",
  // For dark surfaces: a translucent outline that reads on brand-800 and similar.
  inverse:
    "border border-white/30 bg-transparent text-white hover:bg-white/10 focus-visible:outline-white",
};

const sizeStyles: Record<Size, string> = {
  sm: "h-9 px-3 text-xs",
  // md and lg keep a 44px target: this is a phone-first app and the primary
  // actions are tapped, not clicked.
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-6 text-base",
};

type CommonProps = {
  variant?: Variant;
  size?: Size;
  className?: string;
  loading?: boolean;
};

type ButtonProps = CommonProps &
  ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };

type LinkProps = CommonProps &
  AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

export function Button(props: ButtonProps | LinkProps) {
  const { variant = "primary", size = "md", className, loading = false, ...rest } = props;
  const classes = cn(
    baseStyles,
    variantStyles[variant],
    sizeStyles[size],
    loading && "cursor-progress",
    className
  );
  // While loading, the label stays visible and a spinner appears before it,
  // so the action keeps its name for screen readers and layout does not shift.
  const content = (
    <>
      {loading ? (
        <LoaderCircle
          aria-hidden="true"
          className="h-4 w-4 shrink-0 animate-spin"
        />
      ) : null}
      {rest.children}
    </>
  );

  if ("href" in rest && rest.href !== undefined) {
    // `rest` already excludes variant, size, className and loading, so the
    // computed classes (which include any className) reach the anchor intact.
    const { href, ...anchorProps } = rest as Omit<
      LinkProps,
      "variant" | "size" | "className" | "loading"
    >;
    return (
      <Link href={href} className={classes} {...anchorProps}>
        {content}
      </Link>
    );
  }

  const { type = "button", ...buttonProps } = rest as ButtonProps;
  return (
    <button
      type={type}
      className={classes}
      aria-busy={loading || undefined}
      {...buttonProps}
    >
      {content}
    </button>
  );
}
