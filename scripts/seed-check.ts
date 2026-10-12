/*
  Seeds a fresh PGlite database in .data/seed-check and checks the demo data.
  Run from the project root:
    npx --yes tsx --conditions=react-server scripts/seed-check.ts
*/
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/lib/db/schema";
import { seedDemo, seedIfEmpty } from "../src/lib/db/seed";

const TABLES = [
  "organizations",
  "users",
  "memberships",
  "subscriptions",
  "invoices",
  "brands",
  "competitors",
  "facts",
  "questions",
  "scans",
  "scan_jobs",
  "answers",
  "citations",
  "statements",
  "issues",
  "issue_events",
  "sources",
  "reports",
  "score_snapshots",
  "competitor_snapshots",
  "usage_costs",
  "alert_rules",
  "outbox",
  "prospects",
  "check_requests",
  "settings",
  "audit_log",
];

const failures: string[] = [];
function check(ok: boolean, message: string) {
  if (!ok) failures.push(message);
}

async function main() {
  const dir = path.join(process.cwd(), ".data", "seed-check");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });

  const started = performance.now();
  // SEED_NOW lets the check try other dates, for example a month boundary.
  const result = await seedDemo(db, process.env.SEED_NOW ? new Date(process.env.SEED_NOW) : new Date());
  const elapsed = (performance.now() - started) / 1000;
  check(result !== null, "first seed returned null");

  const again = performance.now();
  await seedIfEmpty(db);
  const secondElapsed = (performance.now() - again) / 1000;

  const counts: Record<string, number> = {};
  for (const table of TABLES) {
    const res = await client.query<{ n: number }>(`select count(*)::int as n from ${table}`);
    counts[table] = res.rows[0].n;
  }
  console.log("Row counts");
  for (const [table, n] of Object.entries(counts)) console.log(`  ${table.padEnd(22)} ${n}`);
  check(counts.organizations === 5, `expected 5 organizations, got ${counts.organizations}`);

  // Spans: every statement must match its answer's substring exactly.
  const spans = await client.query<{ id: string; text: string; span_start: number; span_end: number; answer: string }>(
    "select s.id, s.text, s.span_start, s.span_end, a.text as answer from statements s join answers a on a.id = s.answer_id",
  );
  let bad = 0;
  for (const row of spans.rows) {
    if (row.answer.slice(row.span_start, row.span_end) !== row.text) bad++;
  }
  check(bad === 0, `${bad} statements do not match their answer span`);
  console.log(`\nStatements checked for spans: ${spans.rows.length}, mismatches: ${bad}`);

  // Text hygiene in answers.
  const answerTexts = await client.query<{ text: string }>("select text from answers");
  const hygiene = answerTexts.rows.filter((r) => /[!*#\[\]]|lorem/i.test(r.text) || /^\s*[-•]/m.test(r.text));
  check(hygiene.length === 0, `${hygiene.length} answers contain markdown, citation markers or exclamation marks`);
  const sentenceCounts = answerTexts.rows.map((r) => r.text.split(/(?<=[.?])\s+/).length);
  console.log(`Answer sentences: min ${Math.min(...sentenceCounts)}, max ${Math.max(...sentenceCounts)}`);

  // Encoding: no mangled characters anywhere a person reads.
  const mojibake = await client.query<{ n: number }>(
    "select (select count(*) from answers where text ~ '(â|Ã)') + (select count(*) from facts where statement ~ '(â|Ã)') + (select count(*) from issues where wrong_statement ~ '(â|Ã)' or correct_statement ~ '(â|Ã)')::int as n",
  );
  check(Number(mojibake.rows[0].n) === 0, `${mojibake.rows[0].n} rows contain mangled characters`);

  // Report findings: wrongStart/wrongEnd must locate the wrong statement.
  const reportRows = await db.select().from(schema.reports);
  let badFindings = 0;
  for (const report of reportRows) {
    for (const f of report.data.topRisks) {
      if (f.answer && f.answer.text.slice(f.answer.wrongStart, f.answer.wrongEnd) !== f.wrong) badFindings++;
    }
  }
  check(badFindings === 0, `${badFindings} report findings have wrong offsets`);
  console.log(`Reports: ${reportRows.map((r) => `${r.title} (${r.data.topRisks.length} risks)`).join("; ")}`);

  // Scan jobs: Woodgrove's failed jobs and Litware's running scan.
  const jobs = await client.query<{ name: string; status: string; scan_status: string; n: number }>(
    "select b.name, j.status, s.status as scan_status, count(*)::int as n from scan_jobs j join scans s on s.id = j.scan_id join brands b on b.id = s.brand_id group by b.name, j.status, s.status order by b.name, j.status",
  );
  console.log(`Scan jobs: ${jobs.rows.map((r) => `${r.name} ${r.scan_status}/${r.status} ${r.n}`).join(", ")}`);

  // Latest Acme snapshot.
  const [acme] = await db.select().from(schema.brands).where(eq(schema.brands.name, "Acme")).limit(1);
  const [latest] = await db
    .select()
    .from(schema.scoreSnapshots)
    .where(eq(schema.scoreSnapshots.brandId, acme.id))
    .orderBy(desc(schema.scoreSnapshots.takenAt))
    .limit(1);
  console.log(`\nAnchor: ${result?.anchor.toISOString()}`);
  console.log(`Latest Acme score: ${latest.accuracyScore} (statements checked ${latest.statementsChecked})`);
  for (const [platform, v] of Object.entries(latest.byPlatform)) console.log(`  ${platform.padEnd(11)} ${v?.score} (checked ${v?.checked}, open ${v?.openIssues})`);
  for (const [category, v] of Object.entries(latest.byCategory)) console.log(`  ${category.padEnd(11)} ${v?.score} (checked ${v?.checked}, open ${v?.openIssues})`);
  console.log(`Open risks: ${latest.openCritical} critical, ${latest.openHigh} high, ${latest.openTotal} open in total`);
  console.log(`Sentiment: ${JSON.stringify(latest.sentiment)}, share of voice ${latest.shareOfVoice}`);
  const score = latest.accuracyScore ?? 0;
  check(score >= 66 && score <= 78, `Acme score ${score} outside 66–78`);

  const history = await db
    .select({ takenAt: schema.scoreSnapshots.takenAt, score: schema.scoreSnapshots.accuracyScore })
    .from(schema.scoreSnapshots)
    .where(eq(schema.scoreSnapshots.brandId, acme.id))
    .orderBy(schema.scoreSnapshots.takenAt);
  console.log(`Score trend: ${history.map((h) => h.score).join(", ")}`);

  const [latestScan] = await db
    .select()
    .from(schema.scans)
    .where(and(eq(schema.scans.brandId, acme.id), eq(schema.scans.type, "scheduled")))
    .orderBy(desc(schema.scans.finishedAt))
    .limit(1);
  console.log(`Latest scan cost: $${latestScan.totalCostUsd}, jobs ${latestScan.jobsTotal}`);
  const answersInLatest = await client.query<{ n: number }>("select count(*)::int as n from answers where scan_id = $1", [latestScan.id]);
  check(answersInLatest.rows[0].n === latestScan.jobsTotal, `latest scan has ${answersInLatest.rows[0].n} answers, expected ${latestScan.jobsTotal}`);

  const pending = await client.query<{ name: string; n: number }>(
    "select b.name, count(*)::int as n from issues i join brands b on b.id = i.brand_id where i.review_state = 'pending' group by b.name order by b.name",
  );
  console.log(`Pending review: ${pending.rows.map((r) => `${r.name} ${r.n}`).join(", ")}`);

  const cost30 = await client.query<{ name: string; usd: number }>(
    `select o.name, round(sum(u.cost_usd)::numeric, 2)::float as usd from usage_costs u join organizations o on o.id = u.organization_id
     where u.day > (current_date - 30) group by o.name order by o.name`,
  );
  console.log(`API cost, last 30 days: ${cost30.rows.map((r) => `${r.name} $${r.usd}`).join(", ")}`);

  console.log(`\nSeed time: ${elapsed.toFixed(2)} s (second call ${secondElapsed.toFixed(2)} s, no-op)`);
  check(elapsed < 15, `seeding took ${elapsed.toFixed(1)} s`);
  const orgsAfter = await client.query<{ n: number }>("select count(*)::int as n from organizations");
  check(orgsAfter.rows[0].n === counts.organizations, "second seed call changed data");

  await client.close();
  if (failures.length) {
    console.error(`\nFAILED\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nAll checks passed.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
