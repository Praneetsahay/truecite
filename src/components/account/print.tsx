"use client";

import { useEffect } from "react";
import { Button, type ButtonVariant } from "@/components/ui/button";

/** Opens the browser's print dialog once the page and its fonts have loaded. */
export function AutoPrint() {
  useEffect(() => {
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (!cancelled) window.print();
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}

/** Opens the browser's print dialog, where the page can also be saved as a PDF. */
export function PrintButton({
  children = "Print or save as PDF",
  variant = "secondary",
  className,
}: {
  children?: React.ReactNode;
  variant?: ButtonVariant;
  className?: string;
}) {
  return (
    <Button variant={variant} className={className} onClick={() => window.print()}>
      {children}
    </Button>
  );
}
