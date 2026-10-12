import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, sources } from "@/lib/db";
import { PLATFORM_IDS, type PlatformId, type SourceType } from "@/lib/domain/constants";
import { appUrl } from "./alerts";
import type { BrandContext } from "./context";
import { contentWords, domainFromWebsite, hostnameOf, keyTokens, numbersIn } from "./text";

/*
  Source tracing: for an issue, take the pages the AI cited in the answers that
  carried the wrong statement, fetch each page once per scan, and check whether
  it contains the claim's specific numbers or names. Pages that do are marked as
  likely sources; the rest stay possible sources.
*/

const FETCH_TIMEOUT_MS = 8_000;
const MAX_PAGES_PER_ISSUE = 6;
const MAX_PAGE_BYTES = 2_000_000;
const NOT_FETCHED = "Could not be fetched";

export type Carrier = {
  platform: PlatformId;
  citations: { url: string; title: string | null }[];
};

export type PageCheck = {
  ok: boolean;
  text: string;
  note: string;
  published: string | null;
};

/** Hosts that never resolve or must not be fetched from a server. */
function unfetchable(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (/\.(example|test|invalid|local|internal)$/.test(host) || host === "example.com" || host.endsWith(".example.com")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return true;
  }
  if (host.includes(":")) return true; // IPv6 literals
  return false;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function publishedLabel(html: string): string | null {
  const match =
    html.match(/<meta[^>]+(?:property|name)=["'](?:article:published_time|og:published_time|date|pubdate|publish-date)["'][^>]*content=["']([^"']+)["']/i) ??
    html.match(/"datePublished"\s*:\s*"([^"]+)"/i) ??
    html.match(/<time[^>]+datetime=["']([^"']+)["']/i);
  if (!match) return null;
  const date = new Date(match[1]);
  if (Number.isNaN(date.getTime())) return null;
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function pageText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#36;|&dollar;/g, "$")
    .replace(/&#8377;/g, "₹")
    .replace(/&(?:quot|#34);/g, '"')
    .replace(/&(?:apos|#39);/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (received >= MAX_PAGE_BYTES) {
      await reader.cancel();
      break;
    }
  }
  return text + decoder.decode();
}

export async function fetchPage(url: string): Promise<PageCheck> {
  const host = hostnameOf(url);
  if (!host || !/^https?:/i.test(url) || unfetchable(host)) return { ok: false, text: "", note: NOT_FETCHED, published: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": `TrueCite source check (+${appUrl()})`,
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
      },
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, text: "", note: response.status === 404 || response.status === 410 ? "Page no longer exists" : `${NOT_FETCHED} (HTTP ${response.status})`, published: null };
    }
    const type = response.headers.get("content-type") ?? "";
    if (/pdf/i.test(type)) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, text: "", note: "PDF, not read", published: null };
    }
    if (type && !/html|text|xml/i.test(type)) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, text: "", note: NOT_FETCHED, published: null };
    }
    const html = await readLimited(response);
    const finalHost = hostnameOf(response.url);
    const note = response.redirected && finalHost && finalHost !== host ? `Redirected to ${finalHost}` : "Still live";
    return { ok: true, text: pageText(html), note, published: publishedLabel(html) };
  } catch {
    return { ok: false, text: "", note: NOT_FETCHED, published: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Whether a page states the claim: all of its specific numbers or names, or nearly all of its words. */
export function pageContainsClaim(page: string, claim: string, brandName: string): boolean {
  if (!page) return false;
  const tokens = keyTokens(claim, brandName);
  if (tokens.length > 0) {
    const pageNumbers = new Set(numbersIn(page));
    const lower = page.toLowerCase();
    return tokens.every((token) => (/\d/.test(token) ? pageNumbers.has(token) : new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower)));
  }
  const words = contentWords(claim);
  if (words.length === 0) return false;
  const pageWords = new Set(contentWords(page));
  return words.filter((w) => pageWords.has(w)).length / words.length >= 0.8;
}

const NEWS_HOSTS = [
  "reuters.com", "bloomberg.com", "techcrunch.com", "forbes.com", "businessinsider.com", "wsj.com", "nytimes.com", "ft.com",
  "bbc.co.uk", "bbc.com", "cnbc.com", "theverge.com", "economictimes.indiatimes.com", "livemint.com", "moneycontrol.com",
  "thehindu.com", "ndtv.com", "business-standard.com", "financialexpress.com", "yourstory.com", "inc42.com", "hindustantimes.com",
];
const REVIEW_HOSTS = ["g2.com", "capterra.com", "trustpilot.com", "getapp.com", "softwareadvice.com", "trustradius.com", "glassdoor.com", "ambitionbox.com", "yelp.com"];
const DIRECTORY_HOSTS = ["crunchbase.com", "zoominfo.com", "dnb.com", "justdial.com", "indiamart.com", "tracxn.com", "pitchbook.com", "owler.com", "zaubacorp.com", "tofler.in"];
const FORUM_HOSTS = ["reddit.com", "quora.com", "stackexchange.com", "stackoverflow.com", "news.ycombinator.com"];
const SOCIAL_HOSTS = ["linkedin.com", "twitter.com", "x.com", "facebook.com", "instagram.com", "youtube.com", "medium.com"];

function matches(host: string, list: readonly string[]): boolean {
  return list.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

export function sourceTypeFor(host: string, ctx: Pick<BrandContext, "domain" | "competitors">): SourceType {
  if (host === ctx.domain || host.endsWith(`.${ctx.domain}`)) return "own_site";
  for (const competitor of ctx.competitors) {
    const domain = domainFromWebsite(competitor.website);
    if (host === domain || host.endsWith(`.${domain}`)) return "competitor";
  }
  if (/(^|\.)wiki(pedia|data)\.org$/.test(host)) return "wikipedia";
  if (matches(host, FORUM_HOSTS) || /forum|community|discuss|answers/.test(host)) return "forum";
  if (matches(host, SOCIAL_HOSTS)) return "social";
  if (matches(host, REVIEW_HOSTS) || /review/.test(host)) return "review_site";
  if (matches(host, DIRECTORY_HOSTS) || /directory|listing|companies|profile/.test(host)) return "directory";
  if (matches(host, NEWS_HOSTS) || /news|times|journal|herald|tribune|gazette|post\./.test(host)) return "news";
  return "other";
}

/**
 * Upserts the sources of one issue from the answers that carried its wrong
 * statement. `pages` caches fetches for the whole scan, so each URL is fetched once.
 */
export async function traceSources(input: {
  issueId: string;
  claim: string;
  ctx: BrandContext;
  carriers: Carrier[];
  pages: Map<string, Promise<PageCheck>>;
  now: Date;
}): Promise<number> {
  const byUrl = new Map<string, { title: string | null; platforms: Set<PlatformId>; count: number; order: number }>();
  let order = 0;
  for (const carrier of input.carriers) {
    for (const citation of carrier.citations) {
      const entry = byUrl.get(citation.url) ?? { title: citation.title, platforms: new Set<PlatformId>(), count: 0, order: order++ };
      entry.platforms.add(carrier.platform);
      entry.count += 1;
      entry.title ??= citation.title;
      byUrl.set(citation.url, entry);
    }
  }
  const chosen = [...byUrl.entries()].sort((a, b) => b[1].count - a[1].count || a[1].order - b[1].order).slice(0, MAX_PAGES_PER_ISSUE);
  if (chosen.length === 0) return 0;

  const db = await getDb();
  let upserted = 0;
  for (const [url, entry] of chosen) {
    let pending = input.pages.get(url);
    if (!pending) {
      pending = fetchPage(url);
      input.pages.set(url, pending);
    }
    const page = await pending;
    const host = hostnameOf(url) ?? url;
    const contains = page.ok && pageContainsClaim(page.text, input.claim, input.ctx.brand.name);
    const [existing] = await db
      .select()
      .from(sources)
      .where(and(eq(sources.issueId, input.issueId), eq(sources.url, url)))
      .limit(1);
    const citedBy = PLATFORM_IDS.filter((p) => entry.platforms.has(p) || existing?.citedBy.includes(p));
    const values = {
      title: entry.title ?? existing?.title ?? null,
      domain: host,
      sourceType: sourceTypeFor(host, input.ctx),
      containsStatement: contains,
      likelihood: contains ? ("likely" as const) : ("possible" as const),
      publishedLabel: page.published ?? existing?.publishedLabel ?? null,
      note: page.note,
      citedBy,
      checkedAt: input.now,
    };
    if (existing) {
      await db.update(sources).set(values).where(eq(sources.id, existing.id));
    } else {
      await db.insert(sources).values({ issueId: input.issueId, url, ...values });
    }
    upserted += 1;
  }
  return upserted;
}
