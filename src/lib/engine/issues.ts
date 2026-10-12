import "server-only";
import {
  CLEAN_SCANS_TO_RESOLVE,
  ERROR_VERDICTS,
  PLATFORM_IDS,
  PLATFORMS,
  type ErrorVerdict,
  type FactCategory,
  type PlatformId,
  type Verdict,
} from "@/lib/domain/constants";
import { claimKeyFor } from "@/lib/domain/consistency";
import { listJoin } from "@/lib/domain/format";
import type { ErrorType } from "@/lib/domain/playbook";
import type { FactEntry } from "./context";
import { keyTokens } from "./text";

/*
  How issues are named, typed and grouped. Titles are written for the client's
  team ("Wrong price for Basic plan", "Names the former CEO"), never as checker
  jargon.
*/

export function isErrorVerdict(verdict: Verdict): verdict is ErrorVerdict {
  return (ERROR_VERDICTS as readonly Verdict[]).includes(verdict);
}

/**
 * The text the consistency rule groups by. The same wrong statement is often
 * worded differently across runs, so errors group by verdict and the specific
 * numbers or names they state ("outdated $49"), and missing answers by the fact
 * they leave out.
 */
export function canonicalClaim(text: string, verdict: Verdict, brandName: string): string {
  if (!isErrorVerdict(verdict)) return text;
  if (verdict === "missing") return "missing";
  const tokens = keyTokens(text, brandName);
  return tokens.length ? `${verdict} ${tokens.join(" ")}` : `${verdict} ${text}`;
}

export function claimKeyOf(input: { factId: string | null; text: string; verdict: Verdict; brandName: string }): string {
  return claimKeyFor(input.factId, canonicalClaim(input.text, input.verdict, input.brandName));
}

export function errorTypeFor(category: FactCategory | null, verdict: ErrorVerdict): ErrorType {
  if (verdict === "missing") return "unreadable_pages";
  if (verdict === "confused") return category === "security" || category === "legal" ? "false_scandal" : "confused_company";
  switch (category) {
    case "pricing":
      return "wrong_price";
    case "products":
      return "product_status";
    case "leadership":
    case "company":
      return "outdated_facts";
    case "policies":
    case "support":
      return "wrong_policy";
    case "legal":
      return "false_scandal";
    default:
      return "other";
  }
}

const TOPIC: Record<FactCategory, string> = {
  pricing: "pricing",
  products: "products",
  leadership: "the leadership team",
  company: "company details",
  policies: "policies",
  support: "support",
  security: "security",
  legal: "legal matters",
  careers: "careers",
};

function planName(text: string): string | null {
  const match = text.match(/\b([A-Z][\w+-]*(?:\s[A-Z][\w+-]*){0,2})\s+(plan|tier|package|edition|subscription)\b/);
  if (!match) return null;
  return `${match[1]} ${match[2].toLowerCase()}`;
}

function roleIn(text: string): string | null {
  const match = text.match(/\b(CEO|CFO|CTO|COO|CMO|chief executive|chief financial officer|chief technology officer|co-founder|founder|chairperson|chairman|chairwoman|president|managing director)\b/i);
  if (!match) return null;
  const role = match[1];
  return /^[A-Z]{3}$/.test(role) ? role : role.toLowerCase();
}

function companyAttribute(text: string): string {
  if (/\bfounded|established|since \d{4}/i.test(text)) return "founding year";
  if (/headquarter|based in|head office/i.test(text)) return "headquarters location";
  if (/employees|staff|team of|people/i.test(text)) return "employee count";
  if (/customers|clients|businesses use/i.test(text)) return "customer count";
  if (/offices?|locations?|countries|markets/i.test(text)) return "locations";
  return "company details";
}

function policyName(text: string): string {
  if (/refund|money[- ]back/i.test(text)) return "refund policy";
  if (/cancel/i.test(text)) return "cancellation policy";
  if (/warrant/i.test(text)) return "warranty";
  if (/trial/i.test(text)) return "free trial terms";
  if (/fee|charge/i.test(text)) return "fees";
  return "policy";
}

/** A title for a new issue, from the fact it is about and what is wrong. */
export function issueTitleFor(input: {
  fact: FactEntry | null;
  verdict: ErrorVerdict;
  wrongStatement: string;
  brandName: string;
}): string {
  const { fact, verdict, wrongStatement, brandName } = input;
  const reference = `${fact?.statement ?? ""} ${wrongStatement}`;
  if (!fact) {
    if (verdict === "confused") return `Confuses ${brandName} with another company`;
    if (verdict === "missing") return `Says it has no information on ${brandName}`;
    return `Wrong statement about ${brandName}`;
  }
  if (verdict === "missing") return `Says it has no information on ${TOPIC[fact.category]}`;

  switch (fact.category) {
    case "pricing": {
      if (verdict === "confused") return "Gives another company's prices";
      const plan = planName(fact.statement) ?? planName(wrongStatement);
      // Prices often differ by market: "Wrong price for Basic plan in India".
      const market = /\bin (India|the UAE|the UK|the US|Europe)\b/i.exec(fact.statement)?.[1] ?? (/₹/.test(fact.statement) ? "India" : null);
      const where = market ? ` in ${market}` : "";
      return plan ? `Wrong price for ${plan}${where}` : verdict === "outdated" ? `Quotes old prices${where}` : `Wrong price${where}`;
    }
    case "leadership": {
      const role = roleIn(reference);
      if (verdict === "outdated") return role ? `Names the former ${role}` : "Names former leadership";
      if (verdict === "confused") return "Names another company's leaders";
      return role ? `Wrong name for the ${role}` : "Wrong leadership details";
    }
    case "company": {
      const attribute = companyAttribute(reference);
      if (verdict === "confused") return `Mixes up ${brandName} with another company`;
      return verdict === "outdated" ? `Outdated ${attribute}` : `Wrong ${attribute}`;
    }
    case "products":
      if (verdict === "outdated") return "Describes a retired product";
      if (verdict === "confused") return "Describes another company's product";
      return "Wrong product details";
    case "policies": {
      const policy = policyName(reference);
      return verdict === "outdated" ? `States an old ${policy}` : `Wrong ${policy}`;
    }
    case "support":
      if (/hours|24\/7|24x7|round the clock/i.test(reference)) return verdict === "outdated" ? "Outdated support hours" : "Wrong support hours";
      return verdict === "outdated" ? "Outdated support details" : "Wrong support details";
    case "security":
      if (verdict === "confused") {
        return /breach|incident|hack|leak/i.test(wrongStatement)
          ? `Confuses ${brandName} with another company's data breach`
          : "Attributes another company's security incident";
      }
      if (/soc|iso|gdpr|hipaa|pci|certif|complian/i.test(reference)) return "Wrong security certification details";
      return "Wrong security details";
    case "legal":
      if (/lawsuit|court|litigation|sued/i.test(wrongStatement)) return `Links ${brandName} to a lawsuit`;
      return "Wrong legal claim";
    case "careers":
      return "Wrong hiring or workplace details";
    default:
      return `Wrong statement about ${brandName}`;
  }
}

/** "Seen in 2 of 3 runs on ChatGPT and 1 of 3 on Gemini." */
export function seenNote(
  seen: Partial<Record<PlatformId, number>>,
  totals: Partial<Record<PlatformId, number>>,
  lead = "Seen in",
): string {
  const parts: string[] = [];
  for (const platform of PLATFORM_IDS) {
    const count = seen[platform];
    if (!count) continue;
    const total = Math.max(totals[platform] ?? count, count);
    const name = PLATFORMS[platform].name;
    parts.push(parts.length === 0 ? `${count} of ${total} ${total === 1 ? "run" : "runs"} on ${name}` : `${count} of ${total} on ${name}`);
  }
  return parts.length ? `${lead} ${listJoin(parts)}.` : `${lead} this scan.`;
}

export function cleanNote(streak: number, fixed: boolean): string {
  if (!fixed) return "Not seen in this scan.";
  return `Not seen in this scan. ${Math.min(streak, CLEAN_SCANS_TO_RESOLVE)} of ${CLEAN_SCANS_TO_RESOLVE} clean scans in a row needed to resolve.`;
}

export const RESOLVED_NOTE = `Correct and consistent for ${CLEAN_SCANS_TO_RESOLVE} scans in a row.`;
