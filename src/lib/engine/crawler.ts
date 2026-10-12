import "server-only";

/*
  Reads the public pages of a company website: the home page plus the pages most
  likely to hold checkable facts (about, pricing, products, leadership, policies,
  press, security, careers). Same origin only, at most about 12 pages, with a
  short timeout per page, a TrueCite user agent and the site's robots.txt rules.
*/

export const CRAWLER_USER_AGENT = "TrueCiteBot/1.0 (reads public pages to draft a company Fact Sheet)";

const DEFAULT_MAX_PAGES = 12;
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_HTML_BYTES = 2_000_000;
const MAX_TEXT_CHARS = 20_000;
const CONCURRENCY = 4;

export type PageKind =
  | "home"
  | "about"
  | "pricing"
  | "products"
  | "leadership"
  | "contact"
  | "policy"
  | "press"
  | "security"
  | "careers"
  | "other";

export type CrawledPage = {
  url: string;
  kind: PageKind;
  title: string;
  description: string;
  /** Readable text with scripts, styles and navigation removed. Line breaks follow block elements. */
  text: string;
  /** Email addresses linked with mailto: on the page. */
  emails: string[];
  /** Organization details from schema.org structured data, when the page has them. */
  organization: StructuredOrganization | null;
};

export type StructuredOrganization = {
  name?: string;
  foundingDate?: string;
  email?: string;
  telephone?: string;
  locality?: string;
  region?: string;
  country?: string;
};

export type CrawlResult = {
  /** The origin pages were read from, after redirects. */
  origin: string | null;
  pages: CrawledPage[];
  /** Pages skipped because robots.txt disallows them. */
  disallowed: string[];
  /** Why the site could not be read, when no page could be fetched. */
  error: string | null;
};

/* Page kinds, in the order they are worth reading, with the words that identify them. */
const KIND_PATTERNS: { kind: PageKind; words: RegExp; paths: string[] }[] = [
  { kind: "pricing", words: /\b(pricing|prices|plans?|cost|subscribe)\b/i, paths: ["/pricing", "/plans"] },
  { kind: "about", words: /\b(about|company|who we are|our story|overview)\b/i, paths: ["/about", "/about-us", "/company"] },
  { kind: "products", words: /\b(products?|features?|solutions?|platform|services)\b/i, paths: ["/products", "/features"] },
  { kind: "leadership", words: /\b(leadership|team|management|founders?|board|executives?|people)\b/i, paths: ["/leadership", "/team", "/management"] },
  { kind: "policy", words: /\b(refunds?|cancellation|terms|privacy|policy|policies|legal|warranty)\b/i, paths: ["/refund-policy", "/terms", "/privacy"] },
  { kind: "contact", words: /\b(contact|support|help|offices?|locations?)\b/i, paths: ["/contact"] },
  { kind: "security", words: /\b(security|trust|compliance|gdpr|soc ?2|iso)\b/i, paths: ["/security", "/trust"] },
  { kind: "press", words: /\b(press|news|newsroom|media|announcements?)\b/i, paths: ["/press", "/news"] },
  { kind: "careers", words: /\b(careers?|jobs|join us|hiring|work with us)\b/i, paths: ["/careers"] },
];

const SKIP_EXTENSIONS = /\.(pdf|jpe?g|png|gif|svg|webp|ico|css|js|json|xml|zip|gz|mp4|mp3|mov|woff2?|ttf|eot)$/i;
/* Long, fast-changing or private pages that rarely state company facts. */
const SKIP_PATHS =
  /\/(blog|changelog|docs?|documentation|articles?|tags?|categor(y|ies)|authors?|feed|search|login|log-in|signin|sign-in|signup|sign-up|register|cart|checkout|account|wp-admin|wp-login|cdn-cgi|status)(\/|$)/i;

/** Accepts "acme.com", "www.acme.com/en" or a full URL, and returns a full https URL. */
export function normalizeWebsite(website: string): URL | null {
  const trimmed = website.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

/* robots.txt: a small parser for the group that applies to TrueCite or to every crawler. */

type RobotsRules = { disallow: string[]; allow: string[] };

export function parseRobots(body: string): RobotsRules {
  type Group = { agents: string[]; disallow: string[]; allow: string[] };
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], disallow: [], allow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "disallow" && value) current.disallow.push(value);
    if (field === "allow" && value) current.allow.push(value);
  }
  const own = groups.filter((g) => g.agents.some((agent) => agent.length > 1 && agent !== "*" && "truecitebot".startsWith(agent)));
  const chosen = own.length > 0 ? own : groups.filter((g) => g.agents.includes("*"));
  return {
    disallow: chosen.flatMap((g) => g.disallow),
    allow: chosen.flatMap((g) => g.allow),
  };
}

function ruleMatches(rule: string, path: string): number {
  // Supports * wildcards and a trailing $ anchor. Returns the rule length on a match, or -1.
  const anchored = rule.endsWith("$");
  const body = anchored ? rule.slice(0, -1) : rule;
  const pattern = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  const regex = new RegExp(`^${pattern}${anchored ? "$" : ""}`);
  return regex.test(path) ? body.length : -1;
}

export function isAllowed(rules: RobotsRules, path: string): boolean {
  let disallowed = -1;
  for (const rule of rules.disallow) disallowed = Math.max(disallowed, ruleMatches(rule, path));
  if (disallowed === -1) return true;
  let allowed = -1;
  for (const rule of rules.allow) allowed = Math.max(allowed, ruleMatches(rule, path));
  // The most specific rule wins; on a tie, Allow wins.
  return allowed >= disallowed;
}

/* HTML to text. */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  middot: "·",
  bull: "•",
  times: "×",
  deg: "°",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function stripElements(html: string, tags: string[]): string {
  let out = html;
  for (const tag of tags) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), " ");
  }
  return out;
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  if (!match) return null;
  return decodeEntities(match[2] ?? match[3] ?? match[4] ?? "").trim();
}

function metaContent(html: string, key: string): string {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const name = attribute(tag, "name") ?? attribute(tag, "property");
    if (name && name.toLowerCase() === key) return clean(attribute(tag, "content") ?? "");
  }
  return "";
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Visible text of an HTML page, without scripts, styles and navigation. Keeps footers on request (they often hold the address). */
export function htmlToText(html: string, options: { keepFooter?: boolean } = {}): string {
  let body = html.replace(/<!--[\s\S]*?-->/g, " ");
  const bodyMatch = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(body);
  if (bodyMatch) body = bodyMatch[1];
  const dropped = ["script", "style", "noscript", "template", "svg", "iframe", "nav", "select", "button", "form"];
  if (!options.keepFooter) dropped.push("footer", "header");
  body = stripElements(body, dropped);
  // Elements marked as navigation or hidden.
  body = body.replace(/<(div|ul|section|aside)\b[^>]*\b(role\s*=\s*["']?navigation|aria-hidden\s*=\s*["']?true)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  body = body
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|section|article|main|aside|li|ul|ol|dl|dt|dd|tr|table|h[1-6]|blockquote|pre|figure|figcaption|address|header|footer)\b[^>]*>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " \t ")
    .replace(/<[^>]+>/g, " ");
  const lines = decodeEntities(body)
    .split(/\n/)
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line) => line.length > 0);
  const out: string[] = [];
  for (const line of lines) {
    if (out[out.length - 1] !== line) out.push(line);
  }
  return out.join("\n").slice(0, MAX_TEXT_CHARS);
}

function readStructuredOrganization(html: string): StructuredOrganization | null {
  const blocks = html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) ?? [];
  for (const block of blocks) {
    const json = block.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "");
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      continue;
    }
    const candidates: unknown[] = [];
    const collect = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === "object") {
        candidates.push(value);
        const graph = (value as Record<string, unknown>)["@graph"];
        if (graph) collect(graph);
      }
    };
    collect(parsed);
    for (const candidate of candidates) {
      const record = candidate as Record<string, unknown>;
      const type = record["@type"];
      const types = (Array.isArray(type) ? type : [type]).map(String);
      if (!types.some((t) => /Organization|Corporation|LocalBusiness/.test(t))) continue;
      const address = (Array.isArray(record.address) ? record.address[0] : record.address) as Record<string, unknown> | undefined;
      const text = (value: unknown) => (typeof value === "string" && value.trim() ? clean(decodeEntities(value)) : undefined);
      const country = address?.addressCountry;
      return {
        name: text(record.name),
        foundingDate: text(record.foundingDate),
        email: text(record.email)?.replace(/^mailto:/i, ""),
        telephone: text(record.telephone),
        locality: text(address?.addressLocality),
        region: text(address?.addressRegion),
        country: text(typeof country === "object" && country ? (country as Record<string, unknown>).name : country),
      };
    }
  }
  return null;
}

type Link = { url: URL; text: string };

function readLinks(html: string, base: URL): Link[] {
  const links: Link[] = [];
  const regex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) {
    const href = attribute(`<a ${match[1]}>`, "href");
    if (!href || href.startsWith("#") || /^(javascript|tel|data):/i.test(href)) continue;
    try {
      const url = new URL(href, base);
      url.hash = "";
      links.push({ url, text: clean(decodeEntities(match[2].replace(/<[^>]+>/g, " "))) });
    } catch {
      // ignore malformed links
    }
  }
  return links;
}

function readEmails(html: string): string[] {
  const emails = new Set<string>();
  for (const match of html.matchAll(/href\s*=\s*["']mailto:([^"'?]+)/gi)) {
    const email = decodeURIComponent(match[1]).trim().toLowerCase();
    if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) emails.add(email);
  }
  return [...emails];
}

function sameSite(a: URL, b: URL): boolean {
  const host = (u: URL) => u.hostname.toLowerCase().replace(/^www\./, "");
  return host(a) === host(b) && a.protocol === b.protocol;
}

function kindOf(url: URL, linkText = ""): PageKind {
  if (url.pathname === "/" || url.pathname === "") return "home";
  const haystack = `${url.pathname.replace(/[-_/]+/g, " ")} ${linkText}`;
  for (const { kind, words } of KIND_PATTERNS) if (words.test(haystack)) return kind;
  return "other";
}

function pageKey(url: URL): string {
  return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "") || "/"}`.toLowerCase();
}

type Fetched = { finalUrl: URL; html: string } | { error: string };

async function fetchHtml(url: URL, timeoutMs: number): Promise<Fetched> {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": CRAWLER_USER_AGENT, accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { error: `The page answered with status ${response.status}.` };
    const type = response.headers.get("content-type") ?? "";
    if (type && !/html|xml/i.test(type)) return { error: "The page is not an HTML page." };
    const buffer = await response.arrayBuffer();
    const html = new TextDecoder("utf-8").decode(buffer.byteLength > MAX_HTML_BYTES ? buffer.slice(0, MAX_HTML_BYTES) : buffer);
    return { finalUrl: new URL(response.url || url.toString()), html };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") return { error: "The page did not answer in time." };
    return { error: "The website could not be reached." };
  }
}

async function fetchRobots(origin: URL, timeoutMs: number): Promise<RobotsRules> {
  try {
    const response = await fetch(new URL("/robots.txt", origin), {
      headers: { "user-agent": CRAWLER_USER_AGENT, accept: "text/plain" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { disallow: [], allow: [] };
    return parseRobots((await response.text()).slice(0, 200_000));
  } catch {
    return { disallow: [], allow: [] };
  }
}

function toPage(url: URL, html: string, kind: PageKind): CrawledPage {
  const title = clean(decodeEntities((/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/<[^>]+>/g, " ")));
  return {
    url: url.toString(),
    kind,
    title,
    description: metaContent(html, "description") || metaContent(html, "og:description"),
    text: htmlToText(html, { keepFooter: kind === "home" || kind === "contact" || kind === "about" }),
    emails: readEmails(html),
    organization: readStructuredOrganization(html),
  };
}

/** Reads the home page and up to `maxPages - 1` likely fact pages of the same site. Never throws. */
export async function crawlSite(
  website: string,
  options: { maxPages?: number; timeoutMs?: number } = {},
): Promise<CrawlResult> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const start = normalizeWebsite(website);
  if (!start) return { origin: null, pages: [], disallowed: [], error: "The website address is not valid." };

  const robots = await fetchRobots(new URL(start.origin), timeoutMs);
  const disallowed: string[] = [];
  const homeUrl = new URL(start.toString());
  if (!isAllowed(robots, homeUrl.pathname)) {
    return { origin: start.origin, pages: [], disallowed: [homeUrl.toString()], error: "The website's robots.txt does not allow reading its pages." };
  }

  const home = await fetchHtml(homeUrl, timeoutMs);
  if ("error" in home) return { origin: start.origin, pages: [], disallowed, error: home.error };

  const base = home.finalUrl;
  const pages: CrawledPage[] = [toPage(base, home.html, "home")];
  const seen = new Set<string>([pageKey(homeUrl), pageKey(base)]);

  // Candidates: links on the home page that look like fact pages, then common paths.
  type Candidate = { url: URL; kind: PageKind; rank: number };
  const candidates: Candidate[] = [];
  const kindRank = new Map(KIND_PATTERNS.map((p, index) => [p.kind, index]));
  for (const link of readLinks(home.html, base)) {
    if (!sameSite(link.url, base) || SKIP_EXTENSIONS.test(link.url.pathname) || SKIP_PATHS.test(link.url.pathname)) continue;
    link.url.search = "";
    const kind = kindOf(link.url, link.text);
    if (kind === "home" || kind === "other") continue;
    // Shallow pages first: /pricing is a better bet than /blog/2021/pricing-update.
    const depth = link.url.pathname.split("/").filter(Boolean).length;
    if (depth > 2) continue;
    candidates.push({ url: link.url, kind, rank: (kindRank.get(kind) ?? 9) * 10 + depth });
  }
  for (const pattern of KIND_PATTERNS) {
    for (const path of pattern.paths) {
      candidates.push({ url: new URL(path, base), kind: pattern.kind, rank: (kindRank.get(pattern.kind) ?? 9) * 10 + 5 });
    }
  }
  candidates.sort((a, b) => a.rank - b.rank);

  // At most two pages of each kind, so policies do not crowd out pricing and leadership.
  const perKind = new Map<PageKind, number>();
  const queue: Candidate[] = [];
  for (const candidate of candidates) {
    const key = pageKey(candidate.url);
    if (seen.has(key)) continue;
    if ((perKind.get(candidate.kind) ?? 0) >= 2) continue;
    if (!isAllowed(robots, candidate.url.pathname)) {
      disallowed.push(candidate.url.toString());
      seen.add(key);
      continue;
    }
    seen.add(key);
    perKind.set(candidate.kind, (perKind.get(candidate.kind) ?? 0) + 1);
    queue.push(candidate);
  }

  // Fetch in small batches until the page budget is used. Guessed paths that 404 cost nothing but time.
  const readKeys = new Set<string>([pageKey(base)]);
  let index = 0;
  while (pages.length < maxPages && index < queue.length) {
    const batch = queue.slice(index, index + CONCURRENCY);
    index += batch.length;
    const results = await Promise.all(batch.map((candidate) => fetchHtml(candidate.url, timeoutMs)));
    results.forEach((result, i) => {
      if ("error" in result || pages.length >= maxPages) return;
      if (!sameSite(result.finalUrl, base)) return;
      const key = pageKey(result.finalUrl);
      if (readKeys.has(key)) return; // redirected to a page already read
      readKeys.add(key);
      pages.push(toPage(result.finalUrl, result.html, batch[i].kind));
    });
  }

  return { origin: base.origin, pages, disallowed, error: null };
}
