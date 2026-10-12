"use client";

import { useEffect } from "react";

/** Each step starts at the top of the page. Rendered with key={step}. */
export function ScrollTop() {
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);
  return null;
}
