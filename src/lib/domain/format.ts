import type { Currency } from "./constants";

/*
  Formatting helpers. Dates use one explicit time zone so the server and the
  browser always render the same text.
*/

export const DISPLAY_TIME_ZONE = process.env.NEXT_PUBLIC_DISPLAY_TIME_ZONE ?? "Asia/Kolkata";

type DateInput = Date | string | number | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  // Plain dates (YYYY-MM-DD) are calendar days, not instants.
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: DISPLAY_TIME_ZONE,
});

const dayNoYearFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: DISPLAY_TIME_ZONE,
});

const monthFormat = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: DISPLAY_TIME_ZONE,
});

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: DISPLAY_TIME_ZONE,
});

/**
 * Dates never break across lines ("1 Mar 2026" stays together), and every
 * month has three letters: British English formats September as "Sept".
 */
const keep = (text: string) => text.replace(/\bSept\b/g, "Sep").replace(/ /g, " ");

/** 11 Oct 2026 */
export function formatDate(value: DateInput): string {
  const date = toDate(value);
  return date ? keep(dayFormat.format(date)) : "–";
}

/** 11 Oct */
export function formatDay(value: DateInput): string {
  const date = toDate(value);
  return date ? keep(dayNoYearFormat.format(date)) : "–";
}

/** October 2026 */
export function formatMonth(value: DateInput): string {
  const date = toDate(value);
  return date ? keep(monthFormat.format(date)) : "–";
}

/** 11 Oct 2026, 14:05 */
export function formatDateTime(value: DateInput): string {
  const date = toDate(value);
  return date ? `${keep(dayFormat.format(date))}, ${timeFormat.format(date)}` : "–";
}

/**
 * "3 days ago", "in 5 days". Pass `now` explicitly: server components must read
 * the request first (see the data access layer) before they create a date.
 */
export function formatRelative(value: DateInput, now: Date): string {
  const date = toDate(value);
  if (!date) return "–";
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  const rtf = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
  for (const [unit, size] of units) {
    if (abs >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

const usdFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdCentsFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inrFormat = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

/** $1,000 or ₹1,20,000 (Indian digit grouping). */
export function formatMoney(amount: number, currency: Currency, options?: { cents?: boolean }): string {
  if (currency === "INR") return inrFormat.format(amount);
  return options?.cents ? usdCentsFormat.format(amount) : usdFormat.format(amount);
}

/** API costs are small; show them with cents, or fractions of a cent when tiny. */
export function formatCost(usd: number): string {
  if (usd > 0 && usd < 0.01) return `$${usd.toFixed(4)}`;
  return usdCentsFormat.format(usd);
}

const numberFormat = new Intl.NumberFormat("en-US");

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

export function formatPercent(share: number | null | undefined, digits = 0): string {
  if (share === null || share === undefined || Number.isNaN(share)) return "–";
  return `${(share * 100).toFixed(digits)}%`;
}

/** "acme.example/old-pricing" from a full URL. */
export function displayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
    return `${parsed.hostname.replace(/^www\./, "")}${path}`;
  } catch {
    return url;
  }
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** "ChatGPT, Gemini and Claude" */
export function listJoin(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : pluralForm}`;
}
