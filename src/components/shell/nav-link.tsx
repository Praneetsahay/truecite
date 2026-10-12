"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/lib/cx";

/** A sidebar link that marks itself as current. `exact` for links whose children are separate pages. */
export function NavLink({
  href,
  children,
  count,
  exact = false,
}: {
  href: string;
  children: React.ReactNode;
  count?: number;
  exact?: boolean;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-base transition-colors",
        active ? "bg-wash font-medium text-ink" : "text-graphite hover:bg-wash hover:text-ink",
      )}
    >
      <span>{children}</span>
      {count ? <span className="figures text-sm text-graphite">{count}</span> : null}
    </Link>
  );
}
