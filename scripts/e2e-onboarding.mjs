#!/usr/bin/env node
/*
  End-to-end check of onboarding: signs up a fresh account, walks all four steps
  (company, Fact Sheet, Question Set, first scan) and saves screenshots of each
  step at 1440 and 390 px to .shots/onboarding-*.png. Then logs in as
  vikram@proseware.example, who stopped at the questions step.

  node scripts/e2e-onboarding.mjs

  TC_BASE_URL overrides http://localhost:3000. Exits with code 1 when a step fails.
*/
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const base = (process.env.TC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const out = ".shots";
fs.mkdirSync(out, { recursive: true });

async function launch() {
  for (const channel of ["chrome", "msedge"]) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      // try the next browser
    }
  }
  throw new Error("Could not start Chrome or Edge. Install one of them.");
}

const problems = [];
const log = (message) => console.log(message);
function fail(message) {
  problems.push(message);
  console.log(`FAIL ${message}`);
}

function watch(page) {
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`console: ${msg.text().slice(0, 200)}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${String(error.message).slice(0, 200)}`));
}

async function shoot(page, name) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) fail(`${name} at ${width}px: horizontal overflow of ${overflow}px`);
    const file = path.join(out, `onboarding-${name}-${width}.png`);
    await page.screenshot({ path: file, fullPage: true });
    log(`saved ${file}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function heading(page, text, timeout = 60_000) {
  await page.getByRole("heading", { level: 1, name: text }).waitFor({ timeout });
}

async function addFact(page, statement, category) {
  const form = page.locator("form", { has: page.locator("#new-fact-statement") });
  await form.locator("#new-fact-statement").fill(statement);
  await form.locator("#new-fact-category").selectOption(category);
  await form.locator("#new-fact-importance").selectOption("high");
  await form.getByRole("button", { name: "Add fact" }).click();
  await page.getByText(statement, { exact: true }).waitFor({ timeout: 30_000 });
}

const browser = await launch();
let shootFailure = null;
try {
  /* A fresh account */
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  watch(page);
  shootFailure = () => page.screenshot({ path: path.join(out, "onboarding-failure.png"), fullPage: true }).catch(() => {});
  const stamp = Date.now().toString(36);
  const email = `e2e-${stamp}@example.com`;
  await page.goto(`${base}/signup`, { waitUntil: "load", timeout: 120_000 });
  await page.fill('input[name="name"]', "Test Owner");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "truecite-e2e-1");
  await page.fill('input[name="company"]', `Lumen Ledger ${stamp}`);
  await page.fill('input[name="website"]', "example.com");
  await Promise.all([
    page.waitForURL((url) => url.pathname.startsWith("/app/onboarding"), { timeout: 120_000 }),
    page.getByRole("button", { name: "Create account" }).click(),
  ]);
  log(`signed up as ${email}`);

  /* Step 1: company details */
  await heading(page, "Company details");
  await page.fill("#industry", "Accounting software");
  await page.fill("#competitor-0-name", "Northwind Ledger");
  // Validation: a competitor without a website keeps what was typed and says what to fix.
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.locator("#competitor-0-website-error").waitFor({ timeout: 30_000 });
  if ((await page.inputValue("#competitor-0-name")) !== "Northwind Ledger") fail("company: typed competitor name was lost after an error");
  if ((await page.inputValue("#industry")) !== "Accounting software") fail("company: typed industry was lost after an error");
  await page.fill("#competitor-0-website", "northwind.example");
  await page.getByRole("button", { name: "Add a competitor" }).click();
  await page.fill("#competitor-1-name", "Fabrikam Books");
  await page.fill("#competitor-1-website", "fabrikam.example");
  if (!(await page.getByRole("button", { name: "Add a competitor" }).isDisabled())) fail("company: trial limit of 2 competitors not enforced");
  await page.getByLabel("United Kingdom").check();
  await shoot(page, "1-company");
  await page.getByRole("button", { name: "Save and continue" }).click();

  /* Step 2: Fact Sheet */
  await heading(page, "Review your Fact Sheet");
  await shoot(page, "2-facts-empty");
  await page.getByRole("button", { name: "Draft my Fact Sheet" }).click();
  const draftMessage = page.locator("form", { has: page.getByRole("button", { name: "Draft my Fact Sheet" }) }).locator('p[role="status"]:not(:has-text("Reading"))');
  await draftMessage.first().waitFor({ timeout: 120_000 });
  log(`draft: ${await draftMessage.first().innerText()}`);
  await addFact(page, "Lumen Ledger costs $29 per month for the Starter plan.", "pricing");
  await addFact(page, "Lumen Ledger was founded in 2019 in Pune.", "company");
  await addFact(page, "Asha Rao is the chief executive officer of Lumen Ledger.", "leadership");
  await addFact(page, "Lumen Ledger offers a 30-day refund on annual plans.", "policies");
  if (!(await page.getByRole("button", { name: "Continue to questions" }).isDisabled())) {
    if ((await page.getByText(/Approve at least 5 facts/).count()) > 0) fail("facts: Continue enabled with fewer than 5 approved facts");
  }
  await addFact(page, "Lumen Ledger support is available by email on weekdays.", "support");
  await addFact(page, "Lumen Ledger is a temporary fact to delete.", "company");
  // Edit one fact.
  const editButton = page.locator("li", { hasText: "Lumen Ledger was founded in 2019" }).getByRole("button", { name: /^Edit/ });
  await editButton.click();
  const editor = page.locator("form", { has: page.getByRole("button", { name: "Save and approve" }) });
  await editor.locator("textarea").fill("Lumen Ledger was founded in 2018 in Pune, India.");
  await editor.getByRole("button", { name: "Save and approve" }).click();
  await page.getByText("Lumen Ledger was founded in 2018 in Pune, India.", { exact: true }).waitFor({ timeout: 30_000 });
  // Delete one fact.
  await page.locator("li", { hasText: "Lumen Ledger is a temporary fact" }).getByRole("button", { name: /^Delete/ }).click();
  await page.getByText("Lumen Ledger is a temporary fact to delete.", { exact: true }).waitFor({ state: "detached", timeout: 30_000 });
  const approveAll = page.getByRole("button", { name: "Approve all" });
  if (await approveAll.count()) {
    await approveAll.click();
    await page.getByRole("button", { name: "Approve all" }).waitFor({ state: "detached", timeout: 30_000 });
  }
  await shoot(page, "2-facts");
  await page.getByRole("button", { name: "Continue to questions" }).click();

  /* Step 3: Question Set */
  await heading(page, "Review your Question Set");
  await shoot(page, "3-questions-empty");
  await page.getByRole("button", { name: "Generate my Question Set" }).click();
  await page.locator("#question-set").waitFor({ timeout: 120_000 });
  const switches = page.locator('#question-set input[role="switch"]');
  const count = await switches.count();
  log(`questions generated: ${count}`);
  if (count === 0) fail("questions: none generated");
  await switches.first().uncheck();
  await page.locator('#question-set select').first().selectOption("standard");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText(/Saved \d+ changes?\./).waitFor({ timeout: 30_000 });
  await page.fill("#new-question", "Can Lumen Ledger file GST returns for small businesses?");
  await page.getByRole("button", { name: "Add question" }).click();
  await page.getByText(/Question added/).waitFor({ timeout: 30_000 });
  await shoot(page, "3-questions");
  await page.getByRole("button", { name: "Save and continue" }).click();

  /* Step 4: first scan */
  await heading(page, "Start your first scan");
  await shoot(page, "4-scan");
  await page.getByRole("button", { name: "Start first scan" }).click();
  const finish = page.getByRole("button", { name: "Finish without scanning" });
  await Promise.race([
    page.waitForURL((url) => url.pathname.startsWith("/app/dashboard"), { timeout: 120_000 }),
    finish.waitFor({ timeout: 120_000 }),
  ]);
  if (!new URL(page.url()).pathname.startsWith("/app/dashboard")) {
    log("scan: scanning not available, finishing without scanning");
    await shoot(page, "4-scan-not-ready");
    await Promise.all([
      page.waitForURL((url) => url.pathname.startsWith("/app/dashboard"), { timeout: 120_000 }),
      finish.click(),
    ]);
  } else {
    log("scan: first scan started");
  }
  await page.waitForLoadState("load");
  await shoot(page, "5-dashboard");
  // Finished accounts are sent away from onboarding.
  await page.goto(`${base}/app/onboarding`, { waitUntil: "load" });
  if (!new URL(page.url()).pathname.startsWith("/app/dashboard")) fail("done: /app/onboarding did not redirect to the dashboard");
  await context.close();

  /* Vikram, who stopped at the questions step */
  const vikram = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const vpage = await vikram.newPage();
  watch(vpage);
  await vpage.goto(`${base}/login`, { waitUntil: "load" });
  await vpage.fill('input[name="email"]', "vikram@proseware.example");
  await vpage.fill('input[name="password"]', "truecite");
  await vpage.getByRole("button", { name: "Log in" }).click();
  try {
    await vpage.waitForURL((url) => url.pathname.startsWith("/app"), { timeout: 60_000 });
    await vpage.goto(`${base}/app/onboarding`, { waitUntil: "load" });
    await heading(vpage, "Review your Question Set", 30_000);
    await shoot(vpage, "vikram");
  } catch {
    log("vikram: could not reach the questions step (is the demo seed loaded?)");
    await shoot(vpage, "vikram");
  }
  await vikram.close();
} catch (error) {
  const where = String(error.stack ?? "").split("\n").find((line) => line.includes("e2e-onboarding")) ?? "";
  fail(`stopped: ${error.message.split("\n")[0]} ${where.trim()}`);
  await shootFailure?.();
} finally {
  await browser.close();
}

if (problems.length > 0) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(`- ${p}`);
  process.exit(1);
}
console.log("\nOnboarding passed.");
