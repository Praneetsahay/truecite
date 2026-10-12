import { PLATFORMS, type PlatformId, type ProspectStatus } from "@/lib/domain/constants";
import { listJoin } from "@/lib/domain/format";
import type { ReportFinding } from "@/lib/domain/report";
import type { ProspectFinding } from "@/lib/queries/admin-business";

/*
  The outreach process and the cold email from the product plan, filled in
  with a prospect's real details.
*/

const STAGE: Record<ProspectStatus, number> = {
  new: 0,
  scanning: 1,
  reviewing: 2,
  report_ready: 3,
  contacted: 4,
  replied: 5,
  call_booked: 6,
  audit_sold: 7,
  won: 8,
  lost: -1,
};

export type OutreachStep = { text: string; done: boolean };

export function outreachSteps(input: {
  status: ProspectStatus;
  hasContact: boolean;
  hasReport: boolean;
}): OutreachStep[] {
  const stage = STAGE[input.status];
  return [
    { text: "Build a list of 100 to 200 target companies in your niche using LinkedIn, industry lists and startup databases.", done: true },
    {
      text: "Find the right person: the head of PR or corporate communications, the brand head or CMO, or the founder at smaller mid-size companies.",
      done: input.hasContact,
    },
    { text: "Run a prospect scan and review the findings yourself. Only send real, clear errors.", done: input.hasReport || stage >= 3 },
    { text: "Send a short, personal message with one or two real findings and offer the free mini-report.", done: stage >= 4 },
    { text: "Follow up two or three times over two weeks, each time adding something new, such as another finding.", done: stage >= 5 },
    { text: "Book a 20-minute call and walk them through the mini-report.", done: stage >= 6 },
    { text: "Offer the paid full audit, credited toward a subscription if they sign up within 30 days.", done: stage >= 7 },
    { text: "Move them to the founding plan and ask for a testimonial once they see results.", done: stage >= 8 },
  ];
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number) => WORDS[n] ?? String(n);

function platformNames(platforms: readonly PlatformId[]): string {
  return listJoin(platforms.map((id) => PLATFORMS[id].name));
}

function clean(text: string): string {
  return text.trim().replace(/\s+/g, " ").replace(/[.\s]+$/, "");
}

/** What the email needs from a finding, whether it comes from an approved issue or a built report. */
export type EmailFinding = {
  title: string;
  platforms: PlatformId[];
  wrongStatement: string;
  correctStatement: string;
  category?: string | null;
  type?: string;
  verdict?: string;
};

export function emailFindingFromIssue(finding: ProspectFinding): EmailFinding {
  return finding;
}

export function emailFindingFromReport(finding: ReportFinding): EmailFinding {
  const title = finding.title.toLowerCase();
  return {
    title: finding.title,
    platforms: finding.platforms,
    wrongStatement: finding.wrong,
    correctStatement: finding.correct,
    category: title.includes("price") ? "pricing" : null,
    verdict: /confus|mix|another (company|firm)/.test(title) ? "confused" : /former|old|still|out of date/.test(title) ? "outdated" : undefined,
  };
}

function subjectFor(company: string, finding: EmailFinding | undefined): string {
  if (!finding) return `What AI assistants tell people about ${company}`;
  const platform = finding.platforms.length > 0 ? PLATFORMS[finding.platforms[0]].name : "AI";
  if (finding.category === "pricing" || finding.type === "wrong_price") return `${platform} is quoting the wrong price for ${company}`;
  if (finding.verdict === "confused" || finding.type === "confused_company") return `${platform} is mixing ${company} up with another company`;
  if (finding.verdict === "outdated") return `${platform} is giving out-of-date facts about ${company}`;
  return `${platform} is getting a fact wrong about ${company}`;
}

/** The sample cold email, with the prospect's company, contact and up to two approved findings. */
export function coldEmail(input: {
  company: string;
  contactName: string | null;
  senderName: string;
  platforms: readonly PlatformId[];
  approved: EmailFinding[];
}): { text: string; filled: boolean } {
  const picked = input.approved.slice(0, 2);
  const firstName = input.contactName?.trim().split(/\s+/)[0] || "there";
  const asked = platformNames(input.platforms.length > 0 ? input.platforms : ["chatgpt", "perplexity"]);

  const lines: string[] = [`Subject: ${subjectFor(input.company, picked[0])}`, "", `Hi ${firstName},`, ""];
  lines.push(`I checked what ${asked} tell people about ${input.company}.`);

  if (picked.length > 0) {
    lines.push(picked.length === 1 ? "One thing stood out:" : "Two things stood out:", "");
    picked.forEach((finding, index) => {
      const said = finding.platforms.length > 0 ? platformNames(finding.platforms) : "One assistant";
      lines.push(`${index + 1}. ${said} ${finding.platforms.length > 1 ? "say" : "says"}: "${clean(finding.wrongStatement)}."`);
      const confused = finding.verdict === "confused" || finding.type === "confused_company";
      lines.push(`   ${confused ? "In fact" : "Your website says"}: ${clean(finding.correctStatement)}.`);
      lines.push("");
    });
    const total = input.approved.length;
    lines.push(
      total > 1
        ? `I've put ${word(total)} findings like these in a short report, along with where each error comes from and how to fix it. Would you like me to send it over?`
        : "I've put this in a short report, along with where the error comes from and how to fix it. Would you like me to send it over?",
    );
  } else {
    lines.push("", "[One or two approved findings go here.]", "");
    lines.push(
      "I've put findings like these in a short report, along with where each error comes from and how to fix it. Would you like me to send it over?",
    );
  }

  lines.push("", input.senderName, "TrueCite", "", "If this isn't useful, reply \"no thanks\" and I won't write again.");
  return { text: lines.join("\n"), filled: picked.length > 0 };
}
