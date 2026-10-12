import "server-only";
import { and, asc, eq, inArray, isNull, min } from "drizzle-orm";
import { brands, facts, getDb, issues, organizations, prospects, questions, reports, scans } from "@/lib/db";
import { PROSPECT_LINK_DAYS, QUESTION_CATEGORY_IDS, type PlatformId } from "@/lib/domain/constants";
import { EngineError } from "./errors";
import { draftFactSheet } from "./facts";
import { generateQuestionSet } from "./questions";
import { buildReport } from "./report-builder";
import { createReport, shareReport } from "./reports";
import { startScan } from "./scans";

/*
  The internal sales tool: a small scan of about 20 to 30 questions on two
  platforms for a prospect, then a short report with three to five real errors
  behind a private link that expires in 30 days.

  Prospect brands live in an internal organization, "TrueCite prospects", which
  never appears as a client.
*/

export const PROSPECT_ORGANIZATION = "TrueCite prospects";
const PROSPECT_PLATFORMS: PlatformId[] = ["chatgpt", "perplexity"];
const PROSPECT_RUNS = 2;
const PROSPECT_QUESTIONS = 25;

async function prospectOrganizationId(): Promise<string> {
  const db = await getDb();
  const [existing] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(and(eq(organizations.internal, true), eq(organizations.name, PROSPECT_ORGANIZATION)))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(organizations)
    .values({ name: PROSPECT_ORGANIZATION, plan: "enterprise", country: "IN", currency: "USD", internal: true })
    .returning({ id: organizations.id });
  return created.id;
}

async function loadProspect(prospectId: string) {
  const db = await getDb();
  const [prospect] = await db.select().from(prospects).where(eq(prospects.id, prospectId)).limit(1);
  if (!prospect) throw new EngineError("This prospect could not be found. Reload the page and try again.");
  return prospect;
}

/** Keeps about 25 questions active: key questions first, then one per category in turn. */
async function trimQuestionSet(brandId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: questions.id, category: questions.category, priority: questions.priority })
    .from(questions)
    .where(eq(questions.brandId, brandId))
    .orderBy(asc(questions.createdAt));
  const keep: string[] = rows.filter((q) => q.priority === "key").map((q) => q.id).slice(0, PROSPECT_QUESTIONS);
  const queues = QUESTION_CATEGORY_IDS.map((category) =>
    rows.filter((q) => q.category === category && q.priority !== "key").map((q) => q.id),
  );
  while (keep.length < PROSPECT_QUESTIONS && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      if (keep.length >= PROSPECT_QUESTIONS) break;
      const next = queue.shift();
      if (next) keep.push(next);
    }
  }
  const keepSet = new Set(keep);
  const drop = rows.filter((q) => !keepSet.has(q.id)).map((q) => q.id);
  if (keep.length > 0) await db.update(questions).set({ active: true }).where(inArray(questions.id, keep));
  if (drop.length > 0) await db.update(questions).set({ active: false }).where(inArray(questions.id, drop));
  return keep;
}

export async function startProspectScan(input: { prospectId: string; triggeredBy: string }): Promise<{ scanId: string }> {
  const db = await getDb();
  const prospect = await loadProspect(input.prospectId);

  // The prospect's brand, inside the internal organization.
  let brandId = prospect.brandId;
  if (brandId) {
    const [brand] = await db.select({ id: brands.id, name: brands.name, website: brands.website }).from(brands).where(eq(brands.id, brandId)).limit(1);
    if (!brand) brandId = null;
    else if (brand.name !== prospect.company || brand.website !== prospect.website) {
      await db.update(brands).set({ name: prospect.company, website: prospect.website }).where(eq(brands.id, brand.id));
    }
  }
  if (!brandId) {
    const organizationId = await prospectOrganizationId();
    const [brand] = await db
      .insert(brands)
      .values({
        organizationId,
        name: prospect.company,
        website: prospect.website,
        industry: prospect.industry,
        platforms: PROSPECT_PLATFORMS,
        runsPerQuestion: PROSPECT_RUNS,
        onboardingStep: "done",
        scanFrequency: "manual",
      })
      .returning({ id: brands.id });
    brandId = brand.id;
    await db.update(prospects).set({ brandId, updatedAt: new Date() }).where(eq(prospects.id, prospect.id));
  }

  // Facts from the prospect's own website, approved by the admin who started the scan.
  await draftFactSheet(brandId);
  await db
    .update(facts)
    .set({ status: "approved", approvedBy: input.triggeredBy, approvedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(facts.brandId, brandId), eq(facts.status, "draft")));

  await generateQuestionSet(brandId);
  const questionIds = await trimQuestionSet(brandId);
  if (questionIds.length === 0) throw new EngineError("No questions could be prepared for this prospect.");

  const { scanId } = await startScan({
    brandId,
    type: "prospect",
    triggeredBy: input.triggeredBy,
    questionIds,
    platforms: PROSPECT_PLATFORMS,
    runsPerQuestion: PROSPECT_RUNS,
    note: `Prospect scan for ${prospect.company}`,
  });
  await db.update(prospects).set({ status: "scanning", updatedAt: new Date() }).where(eq(prospects.id, prospect.id));
  return { scanId };
}

/** Builds the prospect report from the reviewed findings (approved issues of the prospect brand). */
export async function createProspectReport(prospectId: string): Promise<{ reportId: string; token: string }> {
  const db = await getDb();
  const prospect = await loadProspect(prospectId);
  if (!prospect.brandId) throw new EngineError("Run the prospect scan first. The report is built from its reviewed findings.");
  const brandId = prospect.brandId;

  const approved = await db
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.brandId, brandId), eq(issues.reviewState, "approved"), isNull(issues.dismissedAt)));
  if (approved.length === 0) {
    throw new EngineError("No findings have been approved for this prospect yet. Approve them in the review queue, then create the report.");
  }

  const [firstScan] = await db
    .select({ startedAt: min(scans.createdAt) })
    .from(scans)
    .where(and(eq(scans.brandId, brandId), eq(scans.type, "prospect")));
  const to = new Date();
  const from = firstScan?.startedAt ?? prospect.createdAt;

  // Building the report again refreshes it and keeps its link.
  let reportId: string | null = null;
  if (prospect.reportId) {
    const [existing] = await db.select({ id: reports.id }).from(reports).where(eq(reports.id, prospect.reportId)).limit(1);
    if (existing) {
      const data = await buildReport({ brandId, type: "prospect", from, to });
      await db.update(reports).set({ data, status: "ready" }).where(eq(reports.id, existing.id));
      reportId = existing.id;
    }
  }
  if (!reportId) reportId = (await createReport({ brandId, type: "prospect", from, to })).reportId;

  const { token } = await shareReport(reportId, PROSPECT_LINK_DAYS);
  // A prospect already further along the pipeline (contacted, replied, won) keeps its status.
  const earlyStage = prospect.status === "new" || prospect.status === "scanning" || prospect.status === "reviewing";
  await db
    .update(prospects)
    .set({ reportId, status: earlyStage ? "report_ready" : prospect.status, updatedAt: new Date() })
    .where(eq(prospects.id, prospect.id));
  return { reportId, token };
}
