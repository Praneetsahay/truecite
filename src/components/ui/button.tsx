import Link from "next/link";
import type { ComponentProps } from "react";
import { cx } from "@/lib/cx";

export type ButtonVariant = "primary" | "secondary" | "quiet";
export type ButtonSize = "sm" | "md";

/**
 * Three kinds of button and nothing else:
 * primary for the one main action on a screen, secondary for everything else,
 * quiet for inline actions that read like links.
 */
export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string) {
  return cx(
    "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors duration-150",
    "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    variant !== "quiet" && "rounded-md",
    variant !== "quiet" && (size === "sm" ? "h-8 px-3 text-sm" : "h-9 px-4 text-base"),
    variant === "primary" && "bg-ink text-paper hover:bg-ink/88",
    variant === "secondary" && "border border-rule-strong bg-sheet text-ink hover:border-ink/40 hover:bg-wash",
    variant === "quiet" &&
      cx("text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink", size === "sm" ? "text-sm" : "text-base"),
    className,
  );
}

type ButtonProps = ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize };

export function Button({ variant, size, className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize };

export function ButtonLink({ variant, size, className, ...props }: ButtonLinkProps) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

/** A plain underlined text link, for links inside sentences and tables. */
export function TextLink({ className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      className={cx("underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink", className)}
      {...props}
    />
  );
}

/** Links that leave TrueCite open in a new tab and say so to screen readers. */
export function ExternalLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cx("underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink", className)}
    >
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
