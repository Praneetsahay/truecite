import type { InferInsertModel } from "drizzle-orm";
import type { PgDatabase, PgInsertValue, PgTable } from "drizzle-orm/pg-core";
import type { PgliteQueryResultHKT } from "drizzle-orm/pglite";
import type * as schema from "../schema";

/*
  Shared helpers for the demo seed: a seeded PRNG (never Math.random), deterministic
  ids, dates relative to the anchor, and batched inserts.
*/

/** The database or a transaction on it. */
export type Db = PgDatabase<PgliteQueryResultHKT, typeof schema>;

export type SeedContext = {
  db: Db;
  /** The moment seeding runs. */
  now: Date;
  /** The latest weekly scan for Acme finished here: the most recent 06:00 IST. */
  anchor: Date;
  /** The anchor as an IST calendar day, YYYY-MM-DD. */
  anchorDay: string;
  newId: () => string;
};

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
const IST_OFFSET = 330 * MINUTE;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a, so any string can seed a generator. */
export function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Rng {
  private readonly next: () => number;

  constructor(seed: number | string) {
    this.next = mulberry32(typeof seed === "string" ? hashString(seed) : seed);
  }

  float(): number {
    return this.next();
  }

  /** Inclusive on both ends. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}

/** A generator seeded from several parts, so each answer or row gets its own stable stream. */
export function rngFor(...parts: (string | number)[]): Rng {
  return new Rng(parts.join("|"));
}

/** Deterministic UUIDs (version 4 layout) from a seeded generator. */
export function idFactory(seed: string): () => string {
  const rng = new Rng(seed);
  return () => {
    const bytes: number[] = [];
    for (let i = 0; i < 16; i++) bytes.push(rng.int(0, 255));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}

/** A url-safe token of the given length, deterministic for a seed. */
export function tokenFor(seed: string, length = 32): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const rng = new Rng(`token|${seed}`);
  let token = "";
  for (let i = 0; i < length; i++) token += alphabet[rng.int(0, alphabet.length - 1)];
  return token;
}

/** The most recent 06:00 Asia/Kolkata (00:30 UTC) at or before `now`. */
export function computeAnchor(now: Date): Date {
  const anchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 30, 0, 0));
  if (anchor.getTime() > now.getTime()) return new Date(anchor.getTime() - DAY);
  return anchor;
}

export function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY);
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * HOUR);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE);
}

/** The calendar day in India for an instant, as YYYY-MM-DD. */
export function istDay(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET).toISOString().slice(0, 10);
}

/** An instant at a given IST wall-clock time on a YYYY-MM-DD day. */
export function istTime(day: string, hour: number, minute = 0): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour, minute) - IST_OFFSET);
}

export function dayParts(day: string): { year: number; month: number; day: number } {
  const [year, month, d] = day.split("-").map(Number);
  return { year, month, day: d };
}

export function makeDay(year: number, month: number, day: number): string {
  // Date.UTC normalises overflow, so month 13 or day 0 work as expected.
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

export function shiftDay(day: string, days: number): string {
  const { year, month, day: d } = dayParts(day);
  return makeDay(year, month, d + days);
}

/** Same day of month, n months later (clamped to the month's length). */
export function shiftMonths(day: string, months: number): string {
  const { year, month, day: d } = dayParts(day);
  const lastDay = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate();
  return makeDay(year, month + months, Math.min(d, lastDay));
}

/** First day of the month containing `day`, shifted by n months. */
export function monthStart(day: string, months = 0): string {
  const { year, month } = dayParts(day);
  return makeDay(year, month + months, 1);
}

export function monthEnd(day: string): string {
  const { year, month } = dayParts(day);
  return makeDay(year, month + 1, 0);
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function monthName(day: string): string {
  return MONTH_NAMES[dayParts(day).month - 1];
}

/** "11 Oct 2026" for a YYYY-MM-DD day. */
export function shortDate(day: string): string {
  const { year, month, day: d } = dayParts(day);
  return `${d} ${MONTH_NAMES[month - 1].slice(0, 3)} ${year}`;
}

export function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

const BATCH = 400;

/** Inserts rows in batches of at most 400. */
export async function insertRows<T extends PgTable>(db: Db, table: T, rows: InferInsertModel<T>[]): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    await db.insert(table).values(rows.slice(i, i + BATCH) as PgInsertValue<T>[]);
  }
}
