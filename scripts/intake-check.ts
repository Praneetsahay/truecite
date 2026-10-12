/*
  Checks the intake side of the engine end to end against a throwaway database:
  Fact Sheet drafting (fallback and real crawler), Question Set generation,
  report data, stored reports, share links, the prospect pipeline and PDF output.

  npx --yes tsx --conditions=react-server scripts/intake-check.ts

  It uses its own PGlite folder (.data/intake-check, deleted first), so it never
  touches the dev database and is safe to run as often as you like. When the demo
  seed is not in place yet, it creates the few records it needs itself.
*/
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), ".data", "intake-check");
fs.rmSync(DIR, { recursive: true, force: true });
process.env.PGLITE_DIR = DIR;

const BASE_URL = (process.env.TC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const DAY = 86_400_000;

let failures = 0;
function check(condition: boolean, label: string) {
  console.log(`  ${condition ? "ok  " : "FAIL"} ${label}`);
  if (!condition) failures++;
}
function heading(text: string) {
  console.log(`\n${text}`);
}
async function timed<T>(label: string, run: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const result = await run();
  console.log(`  (${label}: ${((Date.now() - started) / 1000).toFixed(1)} s)`);
  return result;
}

async function main() {
  const db = await import("../src/lib/db");
  const { eq, ilike, sql } = await import("drizzle-orm");
  const engine = await import("../src/lib/engine");
  const { getDb } = db;

  const conn = await timed("open, migrate and seed the check database", () => getDb());

  /* Fixtures, only when the demo seed has not created them. */
  async function findBrand(name: string) {
    const [row] = await conn.select().from(db.brands).where(ilike(db.brands.name, name)).limit(1);
    return row ?? null;
  }

  let proseware = await findBrand("Proseware");
  if (!proseware) {
    console.log("  Proseware is not in the seed yet: creating it for this check.");
    const [org] = await conn.insert(db.organizations).values({ name: "Proseware", plan: "trial" }).returning();
    [proseware] = await conn
      .insert(db.brands)
      .values({
        organizationId: org.id,
        name: "Proseware",
        website: "https://proseware.example",
        description: "Proseware makes project planning software for construction firms.",
        industry: "Project planning software",
        markets: ["IN", "AE"],
        onboardingStep: "questions",
      })
      .returning();
  }

  let acme = await findBrand("Acme");
  if (!acme) {
    console.log("  Acme is not in the seed yet: creating a small Acme for this check.");
    acme = await createAcmeFixture(conn, db);
  }

  /* 1. Fact Sheet fallback: proseware.example cannot be fetched. */
  heading("1. Draft the Fact Sheet for Proseware (site cannot be fetched, so the fallback runs)");
  const first = await timed("draftFactSheet", () => engine.draftFactSheet(proseware.id));
  console.log(`  created ${first.created}, pages read ${first.pagesRead.length}, simulated ${first.simulated}`);
  const prosewareFacts = await conn.select().from(db.facts).where(eq(db.facts.brandId, proseware.id));
  for (const fact of prosewareFacts.filter((f) => f.origin === "website" && f.status === "draft")) {
    console.log(`    [${fact.category}/${fact.importance}] ${fact.statement}`);
  }
  check(first.simulated, "fallback is marked simulated");
  check(first.pagesRead.length === 0, "no pages were read from proseware.example");
  const again = await engine.draftFactSheet(proseware.id);
  check(again.created === 0, `running it again creates nothing (created ${again.created})`);

  /* 2. Fact Sheet from a real site. */
  heading("2. Draft the Fact Sheet for a brand at https://example.com (real crawler)");
  const [scratchOrg] = await conn
    .insert(db.organizations)
    .values({ name: "Intake check", plan: "professional", currency: "USD", country: "US" })
    .returning();
  const [example] = await conn
    .insert(db.brands)
    .values({ organizationId: scratchOrg.id, name: "Example", website: "https://example.com", markets: ["US"] })
    .returning();
  const crawled = await timed("draftFactSheet", () => engine.draftFactSheet(example.id));
  console.log(`  created ${crawled.created}, simulated ${crawled.simulated}`);
  for (const url of crawled.pagesRead) console.log(`    read ${url}`);
  const exampleFacts = await conn.select().from(db.facts).where(eq(db.facts.brandId, example.id));
  for (const fact of exampleFacts) console.log(`    [${fact.category}/${fact.importance}] ${fact.statement}  (${fact.sourceUrl})`);
  if (crawled.pagesRead.length === 0) {
    console.log("  example.com could not be reached from this machine (offline?), so only the fallback ran.");
  } else {
    check(crawled.pagesRead[0].startsWith("https://example.com"), "the home page was read");
    check(crawled.pagesRead.length <= 12, "at most 12 pages were read");
  }
  check(exampleFacts.every((f) => f.status === "draft" && f.origin === "website"), "facts are drafts from the website");
  check((await engine.draftFactSheet(example.id)).created === 0, "running it again creates nothing");

  /* 3. Question Sets. */
  heading("3. Generate Question Sets");
  for (const brand of [proseware, example]) {
    const [org] = await conn.select().from(db.organizations).where(eq(db.organizations.id, brand.organizationId));
    const before = (await conn.select().from(db.questions).where(eq(db.questions.brandId, brand.id))).length;
    if (brand.id === example.id) {
      await conn.update(db.facts).set({ status: "approved" }).where(eq(db.facts.brandId, brand.id));
      await conn.insert(db.competitors).values([
        { brandId: brand.id, name: "Contoso", website: "https://contoso.example" },
        { brandId: brand.id, name: "Fabrikam", website: "https://fabrikam.example" },
      ]);
    }
    const result = await timed(`generateQuestionSet ${brand.name}`, () => engine.generateQuestionSet(brand.id));
    const rows = await conn.select().from(db.questions).where(eq(db.questions.brandId, brand.id));
    const created = rows.slice(before);
    const generated = rows.filter((q) => q.origin === "generated");
    const byCategory = new Map<string, number>();
    for (const q of generated) byCategory.set(q.category, (byCategory.get(q.category) ?? 0) + 1);
    const keys = generated.filter((q) => q.priority === "key").length;
    console.log(
      `  ${brand.name} (${org.plan} plan): created ${result.created}, ${rows.filter((q) => q.active).length} active in total; key ${keys} of ${generated.length}`,
    );
    console.log(`    by category: ${[...byCategory].map(([c, n]) => `${c} ${n}`).join(", ")}`);
    for (const q of created.slice(0, 8)) console.log(`    ${q.priority === "key" ? "key " : "    "}${q.text}`);
    const limit = org.plan === "trial" ? 30 : org.plan === "starter" ? 50 : org.plan === "professional" ? 100 : 200;
    check(rows.filter((q) => q.active).length <= limit, `stays within the plan's ${limit} questions`);
    check(byCategory.size === 8 || result.created < 8, "every category is covered");
    for (const category of ["pricing", "company", "trust"]) {
      check(generated.some((q) => q.category === category && q.priority === "key"), `has a key ${category} question`);
    }
    const second = await engine.generateQuestionSet(brand.id);
    const total = (await conn.select({ n: sql<number>`count(*)` }).from(db.questions).where(eq(db.questions.brandId, brand.id)))[0].n;
    check(second.created === 0 || Number(total) <= limit, `running it again adds no duplicates (created ${second.created})`);
    const texts = rows.map((q) => q.text.toLowerCase());
    check(new Set(texts).size === texts.length, "no duplicate questions");
  }

  /* 4. Report data for Acme, last full month. */
  heading("4. Build report data for Acme, last full month");
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1);
  const data = await timed("buildReportData", () => engine.buildReportData({ brandId: acme.id, type: "monthly", from, to }));
  printReport(data);
  check(data.summary.split(/[.”]\s+/).length >= 2, "summary has at least two sentences");
  check(data.topRisks.length <= 5, "at most five top risks");
  check(data.nextSteps.length >= 3 && data.nextSteps.length <= 4, "three or four next steps");
  for (const risk of data.topRisks) {
    if (!risk.answer) continue;
    const marked = risk.answer.text.slice(risk.answer.wrongStart, risk.answer.wrongEnd);
    check(marked.length > 0 && risk.answer.wrongEnd <= risk.answer.text.length, `excerpt offsets are valid for “${risk.title}” (marks “${marked}”)`);
  }
  check(!data.topRisks.some((r) => r.status === "resolved"), "no resolved issue is listed as a risk");

  heading("4b. Audit and prospect wording for the same brand");
  const audit = await engine.buildReportData({ brandId: acme.id, type: "audit", from: new Date(to.getTime() - 13 * DAY), to });
  console.log(`  audit: ${audit.periodLabel}\n    ${audit.summary}`);
  const prospectData = await engine.buildReportData({ brandId: acme.id, type: "prospect", from, to: now });
  console.log(`  prospect: ${prospectData.periodLabel}\n    ${prospectData.summary}`);
  for (const step of prospectData.nextSteps) console.log(`    next: ${step}`);
  check(prospectData.score.trend.length === 0 && prospectData.competitors.length === 0, "prospect report has no trend or competitors");

  /* 5. Stored report and share link. */
  heading("5. Create the monthly report and a share link");
  const created = await engine.createReport({ brandId: acme.id, type: "monthly", from, to });
  const [stored] = await conn.select().from(db.reports).where(eq(db.reports.id, created.reportId));
  console.log(`  report ${created.reportId}: “${stored.title}”, period ${stored.period}`);
  const createdAgain = await engine.createReport({ brandId: acme.id, type: "monthly", from, to });
  check(createdAgain.reportId === created.reportId, "creating the same month again reuses the report");
  const share = await engine.shareReport(created.reportId);
  console.log(`  token ${share.token}, expires ${share.expiresAt.toISOString()}`);
  check(share.token.length === 32 && /^[A-Za-z0-9_-]+$/.test(share.token), "token is 32 URL-safe characters");
  const shareAgain = await engine.shareReport(created.reportId);
  check(shareAgain.token === share.token, "sharing again keeps the same link");
  const auditReport = await engine.createReport({ brandId: acme.id, type: "audit", from: new Date(to.getTime() - 13 * DAY), to });
  const [auditRow] = await conn.select().from(db.reports).where(eq(db.reports.id, auditReport.reportId));
  check(auditRow.title === "Full audit", `audit title is “${auditRow.title}”`);

  /* 6. Prospect pipeline. */
  heading("6. Prospect pipeline");
  let [prospect] = await conn.select().from(db.prospects).where(eq(db.prospects.status, "new")).limit(1);
  if (!prospect) {
    [prospect] = await conn
      .insert(db.prospects)
      .values({ company: "Trey Research", website: "https://treyresearch.example", industry: "Market research", contactName: "Ana Silva" })
      .returning();
  }
  const [admin] = await conn.select().from(db.users).where(eq(db.users.isAdmin, true)).limit(1);
  const adminId =
    admin?.id ??
    (await conn.insert(db.users).values({ name: "Check admin", email: "check-admin@truecite.example", passwordHash: "x", isAdmin: true }).returning())[0].id;
  try {
    const scan = await timed("startProspectScan", () => engine.startProspectScan({ prospectId: prospect.id, triggeredBy: adminId }));
    console.log(`  scan started: ${scan.scanId}`);
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    console.log(`  startProspectScan stopped at the scan: ${name}: ${error instanceof Error ? error.message : error}`);
    check(name === "EngineNotReadyError" || name === "EngineError", "the scanning error is passed on unchanged");
  }
  [prospect] = await conn.select().from(db.prospects).where(eq(db.prospects.id, prospect.id));
  check(prospect.brandId !== null, "the prospect has a brand");
  const prospectBrandId = prospect.brandId!;
  const [prospectBrand] = await conn.select().from(db.brands).where(eq(db.brands.id, prospectBrandId));
  const [internalOrg] = await conn.select().from(db.organizations).where(eq(db.organizations.id, prospectBrand.organizationId));
  check(internalOrg.internal && internalOrg.name === "TrueCite prospects", "the brand belongs to the internal organization");
  check(
    JSON.stringify(prospectBrand.platforms) === JSON.stringify(["chatgpt", "perplexity"]) && prospectBrand.runsPerQuestion === 2,
    "the brand runs on ChatGPT and Perplexity, twice per question",
  );
  const prospectFacts = await conn.select().from(db.facts).where(eq(db.facts.brandId, prospectBrandId));
  check(prospectFacts.length > 0 && prospectFacts.every((f) => f.status === "approved" && f.approvedBy === adminId), `facts approved by the admin (${prospectFacts.length})`);
  const prospectQuestions = await conn.select().from(db.questions).where(eq(db.questions.brandId, prospectBrandId));
  const activeQuestions = prospectQuestions.filter((q) => q.active);
  console.log(`  questions: ${activeQuestions.length} active of ${prospectQuestions.length}`);
  check(activeQuestions.length >= 20 && activeQuestions.length <= 30, "about 25 questions are active");

  try {
    await engine.createProspectReport(prospect.id);
    check(false, "a report without approved findings is refused");
  } catch (error) {
    console.log(`  without findings: ${error instanceof Error ? error.message : error}`);
    check(error instanceof Error && error.name === "EngineError", "a report without approved findings is refused with a clear message");
  }
  await addProspectFinding(conn, db, prospectBrandId);
  const prospectReport = await engine.createProspectReport(prospect.id);
  const prospectAgain = await engine.createProspectReport(prospect.id);
  [prospect] = await conn.select().from(db.prospects).where(eq(db.prospects.id, prospect.id));
  const [prospectRow] = await conn.select().from(db.reports).where(eq(db.reports.id, prospectReport.reportId));
  console.log(`  report ${prospectReport.reportId}, token ${prospectReport.token}, expires ${prospectRow.shareExpiresAt?.toISOString()}`);
  console.log(`    ${prospectRow.data.summary}`);
  check(prospect.status === "report_ready" && prospect.reportId === prospectReport.reportId, "the prospect is marked report ready");
  check(prospectAgain.reportId === prospectReport.reportId && prospectAgain.token === prospectReport.token, "running it again keeps the report and link");
  const days = ((prospectRow.shareExpiresAt?.getTime() ?? 0) - Date.now()) / DAY;
  check(days > 29 && days <= 30.01, `the link expires in 30 days (${days.toFixed(2)})`);

  /* 7. PDF. */
  heading("7. Render a PDF from the dev server");
  let pageUrl = `${BASE_URL}/sample-report`;
  let up = false;
  try {
    const response = await fetch(pageUrl, { signal: AbortSignal.timeout(90_000) });
    up = true;
    if (!response.ok) {
      console.log(`  ${pageUrl} answered ${response.status}; using the landing page instead to check the PDF path.`);
      pageUrl = `${BASE_URL}/`;
    }
  } catch {
    console.log(`  The dev server at ${BASE_URL} is not running, so no PDF was rendered.`);
  }
  if (up) {
    const pdf = await timed("renderReportPdf", () => engine.renderReportPdf({ url: pageUrl }));
    if (!pdf) {
      console.log("  No Chrome or Edge could be started, so the caller would fall back to the print dialog.");
    } else {
      fs.mkdirSync(".shots", { recursive: true });
      fs.writeFileSync(path.join(".shots", "report-check.pdf"), pdf);
      const header = Buffer.from(pdf.slice(0, 5)).toString("latin1");
      console.log(`  ${pageUrl} -> .shots/report-check.pdf, ${(pdf.byteLength / 1024).toFixed(1)} KB`);
      check(header === "%PDF-", "the file is a PDF");
    }
  }
  const unreachable = await engine.renderReportPdf({ url: "http://127.0.0.1:9/nothing-here" }).then(
    () => "no error",
    (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error)),
  );
  console.log(`  unreachable page: ${unreachable}`);

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

type Db = Awaited<ReturnType<(typeof import("../src/lib/db"))["getDb"]>>;
type Schema = typeof import("../src/lib/db");

function printReport(data: import("../src/lib/domain/report").ReportData) {
  console.log(`  ${data.brandName}, ${data.periodLabel} (${data.type})`);
  console.log(`  summary: ${data.summary}`);
  console.log(
    `  score ${data.score.current ?? "–"} (previous ${data.score.previous ?? "–"}), trend ${data.score.trend.map((p) => `${p.date.slice(5)} ${Math.round(p.score)}`).join(", ")}`,
  );
  console.log(`  open risks: ${data.openRisks.critical} critical, ${data.openRisks.high} high`);
  console.log(`  by platform: ${data.byPlatform.map((p) => `${p.platform} ${p.score === null ? "–" : Math.round(p.score)} (${p.openIssues} open)`).join(", ")}`);
  for (const risk of data.topRisks) {
    console.log(`  risk ${risk.issueNumber}: ${risk.title} [${risk.severity}, ${risk.status}] on ${risk.platforms.join(", ")}`);
    console.log(`    asked: ${risk.question}`);
    if (risk.answer) {
      const a = risk.answer;
      console.log(`    ${a.platform}: ${a.text.slice(0, a.wrongStart)}[[${a.text.slice(a.wrongStart, a.wrongEnd)}]]${a.text.slice(a.wrongEnd)}`.replace(/\n/g, " / "));
    } else {
      console.log(`    no stored answer; wrong: ${risk.wrong}`);
    }
    console.log(`    correct: ${risk.correct}; sources: ${risk.likelySources.join(", ") || "none"}; fix steps ${risk.fix.length}`);
  }
  for (const item of data.fixed) console.log(`  fixed: ${item.title} on ${item.resolvedOn}`);
  for (const step of data.nextSteps) console.log(`  next: ${step}`);
  for (const row of data.competitors) {
    console.log(`  competitor: ${row.name}${row.isClient ? " (client)" : ""} ${row.score === null ? "–" : Math.round(row.score)}${row.estimate ? " est." : ""}`);
  }
  const m = data.method;
  console.log(`  method: ${m.from} to ${m.to}, ${m.questions} questions x ${m.runsPerQuestion} runs on ${m.platforms.join(", ")}, ${m.scans} scans, ${m.notes.length} notes`);
}

/** A small Acme: three issues across the last month, with answers, statements, events, sources and snapshots. */
async function createAcmeFixture(conn: Db, db: Schema) {
  const now = Date.now();
  const monthStart = (() => {
    const d = new Date();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1);
  })();
  const at = (days: number) => new Date(monthStart + days * DAY);
  const [org] = await conn.insert(db.organizations).values({ name: "Acme", plan: "professional", currency: "USD", country: "IN" }).returning();
  const [brand] = await conn
    .insert(db.brands)
    .values({
      organizationId: org.id,
      name: "Acme",
      website: "https://acme.example",
      industry: "Payroll and HR software",
      markets: ["IN", "AE", "GB"],
      platforms: ["chatgpt", "gemini", "perplexity", "claude"],
      runsPerQuestion: 3,
      onboardingStep: "done",
      scanFrequency: "weekly",
    })
    .returning();
  const competitorRows = await conn
    .insert(db.competitors)
    .values(["Northwind Payroll", "Fabrikam HR", "Contoso People"].map((name) => ({ brandId: brand.id, name, website: `https://${name.split(" ")[0].toLowerCase()}.example` })))
    .returning();
  const [price] = await conn
    .insert(db.facts)
    .values([
      { brandId: brand.id, category: "pricing" as const, statement: "The Basic plan costs $79 per month.", importance: "critical" as const, status: "approved" as const, validFrom: "2026-04-01" },
      { brandId: brand.id, category: "leadership" as const, statement: "Meera Iyer has been Chief Executive Officer since 1 January 2025.", importance: "high" as const, status: "approved" as const },
      { brandId: brand.id, category: "products" as const, statement: "Acme's products are Acme Payroll, Acme Attendance, Acme Spend and Acme Insights.", importance: "high" as const, status: "approved" as const },
    ])
    .returning();
  const qs = await conn
    .insert(db.questions)
    .values([
      { brandId: brand.id, text: "How much does Acme cost?", category: "pricing" as const, priority: "key" as const },
      { brandId: brand.id, text: "Has Acme had a data breach?", category: "reputation" as const, priority: "key" as const },
      { brandId: brand.id, text: "Who is the CEO of Acme?", category: "company" as const, priority: "key" as const },
      { brandId: brand.id, text: "What is Acme's refund policy?", category: "policies" as const },
    ])
    .returning();
  const platforms = ["chatgpt", "gemini", "perplexity", "claude"] as const;
  const scanDays = [-5, 2, 9, 16, 23];
  const scores = [64, 66, 69, 71, 74];
  const scanRows = [];
  for (let i = 0; i < scanDays.length; i++) {
    const startedAt = at(scanDays[i]);
    const [scan] = await conn
      .insert(db.scans)
      .values({
        brandId: brand.id,
        type: "scheduled",
        status: "completed",
        platforms: [...platforms],
        runsPerQuestion: 3,
        questionCount: 100,
        jobsTotal: 1200,
        jobsDone: 1200,
        startedAt,
        finishedAt: new Date(startedAt.getTime() + 40 * 60_000),
        createdAt: startedAt,
      })
      .returning();
    scanRows.push(scan);
    await conn.insert(db.scoreSnapshots).values({
      brandId: brand.id,
      scanId: scan.id,
      takenAt: scan.finishedAt!,
      accuracyScore: scores[i],
      statementsChecked: 900,
      openCritical: 1,
      openHigh: 2,
      openTotal: 4,
      byPlatform: {
        chatgpt: { score: scores[i] - 4, checked: 220, openIssues: 2 },
        gemini: { score: scores[i] + 3, checked: 230, openIssues: 1 },
        perplexity: { score: scores[i] - 8, checked: 210, openIssues: 2 },
        claude: { score: scores[i] + 6, checked: 240, openIssues: 1 },
      },
      sentiment: { positive: 0.46, neutral: 0.41, negative: 0.13 },
      shareOfVoice: 0.31,
    });
    for (const [n, competitor] of competitorRows.entries()) {
      await conn.insert(db.competitorSnapshots).values({
        competitorId: competitor.id,
        brandId: brand.id,
        scanId: scan.id,
        takenAt: scan.finishedAt!,
        accuracyScore: [82, 70, 61][n],
        shareOfVoice: [0.28, 0.22, 0.19][n],
        sentiment: { positive: 0.5, neutral: 0.4, negative: 0.1 },
      });
    }
  }
  const latest = scanRows[scanRows.length - 1];
  const issue = async (values: Partial<typeof db.issues.$inferInsert> & Pick<typeof db.issues.$inferInsert, "number" | "title" | "type" | "verdict" | "severity" | "wrongStatement" | "correctStatement">) => {
    const [row] = await conn
      .insert(db.issues)
      .values({ brandId: brand.id, reviewState: "approved", firstSeenAt: at(2), lastSeenAt: at(23), updatedAt: at(23), ...values })
      .returning();
    return row;
  };
  const answer = async (questionId: string, platform: (typeof platforms)[number], text: string) => {
    const [row] = await conn
      .insert(db.answers)
      .values({ scanId: latest.id, questionId, brandId: brand.id, platform, model: "check", runNumber: 1, text, settings: { webSearch: true }, createdAt: at(23) })
      .returning();
    return row;
  };

  const i101 = await issue({ number: 101, title: "Wrong price for Basic plan", type: "wrong_price", verdict: "outdated", severity: "high", status: "fixed_rechecking", wrongStatement: "$49 per month", correctStatement: "$79 per month", factId: price.id, questionId: qs[0].id, platforms: ["chatgpt", "perplexity"], fixProgress: [0, 1, 2, 3], category: "pricing" });
  const priceText = "Acme offers three plans for growing teams. The **Basic plan** costs $49 per month and includes up to five admin users [1]. For larger teams, the Growth plan adds phone support and Acme Insights.";
  const a101 = await answer(qs[0].id, "chatgpt", priceText);
  const s101 = priceText.indexOf("$49 per month");
  await conn.insert(db.statements).values({ answerId: a101.id, brandId: brand.id, text: "$49 per month", claimKey: "price:basic", verdict: "outdated", spanStart: s101, spanEnd: s101 + 13, issueId: i101.id });
  await conn.insert(db.sources).values({ issueId: i101.id, url: "https://techbench.example/reviews/acme-payroll-review-2023", domain: "techbench.example", sourceType: "review_site", likelihood: "likely", containsStatement: true });

  const i102 = await issue({ number: 102, title: "Data breach confused with another company", type: "confused_company", verdict: "confused", severity: "critical", status: "in_progress", wrongStatement: "Acme disclosed a data breach in 2023 that exposed employee payroll records", correctStatement: "Acme has never reported a data breach. The 2023 breach was at Acme Logistics, an unrelated company.", questionId: qs[1].id, platforms: ["perplexity", "gemini"], category: "reputation" });
  const breachText = "## Security record\n- Acme disclosed a data breach in 2023 that exposed employee payroll records, according to several news reports.\n- The company says it has since added two-factor sign-in for all admins.";
  const a102 = await answer(qs[1].id, "perplexity", breachText);
  const s102 = breachText.indexOf("Acme disclosed");
  await conn.insert(db.statements).values({ answerId: a102.id, brandId: brand.id, text: i102.wrongStatement, claimKey: "breach", verdict: "confused", spanStart: s102, spanEnd: s102 + i102.wrongStatement.length, issueId: i102.id });

  const i103 = await issue({ number: 103, title: "Names the former CEO", type: "outdated_facts", verdict: "outdated", severity: "high", status: "open", origin: "memory", wrongStatement: "Rahul Mehta is the CEO of Acme", correctStatement: "Meera Iyer has been Chief Executive Officer since 1 January 2025.", questionId: qs[2].id, platforms: ["claude"], category: "company" });
  await answer(qs[2].id, "claude", "Rahul Mehta is the CEO of Acme, which he co-founded in 2014. He has led the company through its expansion into the UAE.");

  const i110 = await issue({ number: 110, title: "Says Acme has no refund policy", type: "wrong_policy", verdict: "incorrect", severity: "medium", status: "resolved", resolvedAt: at(16), updatedAt: at(16), wrongStatement: "Acme does not offer refunds", correctStatement: "Acme refunds annual plans within 30 days.", questionId: qs[3].id, platforms: ["gemini"], firstSeenAt: at(-20) });
  await conn.insert(db.issueEvents).values([
    { issueId: i101.id, kind: "status", fromStatus: "open", toStatus: "in_progress", actorName: "Priya", createdAt: at(3) },
    { issueId: i101.id, kind: "status", fromStatus: "in_progress", toStatus: "fixed_rechecking", actorName: "Priya", createdAt: at(10) },
    { issueId: i110.id, kind: "resolved", fromStatus: "fixed_rechecking", toStatus: "resolved", actorName: "TrueCite", createdAt: at(16) },
  ]);
  await issue({ number: 115, title: "Waiting for review", type: "other", verdict: "incorrect", severity: "critical", reviewState: "pending", wrongStatement: "x", correctStatement: "y" });
  await issue({ number: 119, title: "Dismissed", type: "other", verdict: "incorrect", severity: "critical", dismissedAt: at(5), wrongStatement: "x", correctStatement: "y" });
  void now;
  return brand;
}

/** One approved finding on the prospect brand, as if an admin had reviewed the scan. */
async function addProspectFinding(conn: Db, schema: Schema, brandId: string) {
  const { eq } = await import("drizzle-orm");
  const [question] = await conn.select().from(schema.questions).where(eq(schema.questions.brandId, brandId)).limit(1);
  const [scan] = await conn
    .insert(schema.scans)
    .values({ brandId, type: "prospect", status: "completed", platforms: ["chatgpt", "perplexity"], runsPerQuestion: 2, questionCount: 25, startedAt: new Date(), finishedAt: new Date() })
    .returning();
  const text = "Trey Research was founded in 1998 in Chicago. It runs consumer surveys for retail brands and charges $5,000 per study.";
  const [answer] = await conn
    .insert(schema.answers)
    .values({ scanId: scan.id, questionId: question.id, brandId, platform: "perplexity", model: "check", runNumber: 1, text, settings: { webSearch: true } })
    .returning();
  const wrong = "founded in 1998 in Chicago";
  const [issue] = await conn
    .insert(schema.issues)
    .values({ brandId, number: 901, title: "Wrong founding year and city", type: "outdated_facts", verdict: "incorrect", severity: "high", reviewState: "approved", wrongStatement: wrong, correctStatement: "Trey Research was founded in 2009 in Seattle.", questionId: question.id, platforms: ["perplexity"], firstSeenAt: new Date(), lastSeenAt: new Date() })
    .onConflictDoNothing()
    .returning();
  if (issue) {
    const start = text.indexOf(wrong);
    await conn.insert(schema.statements).values({ answerId: answer.id, brandId, text: wrong, claimKey: "founded", verdict: "incorrect", spanStart: start, spanEnd: start + wrong.length, issueId: issue.id });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
