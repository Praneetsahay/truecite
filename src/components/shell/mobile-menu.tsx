"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cx } from "@/lib/cx";

/**
 * A disclosure menu for small screens. It works without JavaScript (it is a
 * <details> element) and closes itself after navigating.
 */
export function MobileMenu({
  children,
  label = "Menu",
  className,
  panelClassName,
}: {
  children: React.ReactNode;
  label?: string;
  className?: string;
  panelClassName?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);

  return (
    <details ref={ref} className={cx("group", className)}>
      <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border border-rule-strong bg-sheet px-3 text-base text-ink [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">{label}</span>
        <span className="hidden group-open:inline">Close</span>
      </summary>
      <div
        className={cx(
          "absolute inset-x-0 top-full z-40 hidden border-b border-rule bg-paper px-4 pt-3 pb-5 group-open:block",
          panelClassName,
        )}
      >
        {children}
      </div>
    </details>
  );
}
