import Link from "next/link";
import { cx } from "@/lib/cx";

/** The TrueCite wordmark. Type only, no symbol. */
export function Wordmark({ href = "/", className, suffix }: { href?: string; className?: string; suffix?: string }) {
  return (
    <Link href={href} className={cx("inline-flex items-baseline gap-2 text-ink", className)}>
      <span className="text-[1.0625rem] font-semibold tracking-[-0.02em]">TrueCite</span>
      {suffix ? <span className="text-sm text-graphite">{suffix}</span> : null}
    </Link>
  );
}
