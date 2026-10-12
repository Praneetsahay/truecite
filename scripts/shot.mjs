#!/usr/bin/env node
/*
  Screenshots of the running app, for checking the UI by eye.

  node scripts/shot.mjs [options] <path> [<path> ...]

  --as <role>     none (default for public pages) | client | member | viewer | admin
  --width <px>    viewport width, default 1440 (use 390 for a phone)
  --height <px>   viewport height, default 900
  --slices        save the page as viewport-sized slices (readable text) instead of one tall image
  --viewport      save only the first screen
  --wait <ms>     extra wait after load, default 400
  --motion        allow animations (default: reduced motion, so the final state is captured)
  --out <dir>     output directory, default .shots

  TC_BASE_URL overrides http://localhost:3000. Prints the HTTP status, final URL,
  browser console errors and any Next.js error overlay text for each page.
*/
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const ACCOUNTS = {
  client: { email: "priya@acme.example", password: "truecite", home: "/app/dashboard" },
  member: { email: "karan@acme.example", password: "truecite", home: "/app/dashboard" },
  viewer: { email: "neha@acme.example", password: "truecite", home: "/app/dashboard" },
  admin: { email: "admin@truecite.example", password: "truecite", home: "/admin" },
};

const argv = process.argv.slice(2);
const opts = { as: "none", width: 1440, height: 900, slices: false, viewport: false, wait: 400, motion: false, out: ".shots" };
const paths = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--as") opts.as = argv[++i];
  else if (arg === "--width") opts.width = Number(argv[++i]);
  else if (arg === "--height") opts.height = Number(argv[++i]);
  else if (arg === "--slices") opts.slices = true;
  else if (arg === "--viewport") opts.viewport = true;
  else if (arg === "--wait") opts.wait = Number(argv[++i]);
  else if (arg === "--motion") opts.motion = true;
  else if (arg === "--out") opts.out = argv[++i];
  else paths.push(arg);
}
if (paths.length === 0) {
  console.error("Give at least one path, such as /pricing or /app/issues/101.");
  process.exit(1);
}
if (opts.as !== "none" && !ACCOUNTS[opts.as]) {
  console.error(`Unknown role "${opts.as}". Use none, client, member, viewer or admin.`);
  process.exit(1);
}

const base = (process.env.TC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
fs.mkdirSync(opts.out, { recursive: true });

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

const browser = await launch();
const statePath = path.join(opts.out, `state-${opts.as}.json`);
const context = await browser.newContext({
  viewport: { width: opts.width, height: opts.height },
  deviceScaleFactor: 1,
  reducedMotion: opts.motion ? "no-preference" : "reduce",
  storageState: opts.as !== "none" && fs.existsSync(statePath) ? statePath : undefined,
});

async function ensureLogin() {
  if (opts.as === "none") return;
  const account = ACCOUNTS[opts.as];
  const page = await context.newPage();
  await page.goto(base + account.home, { waitUntil: "load", timeout: 120_000 });
  if (new URL(page.url()).pathname.startsWith("/login")) {
    await page.fill('input[name="email"]', account.email);
    await page.fill('input[name="password"]', account.password);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 120_000 }),
      page.click('button[type="submit"]'),
    ]);
    await context.storageState({ path: statePath });
  }
  await page.close();
}

function slug(p) {
  return (p.replace(/^\//, "").replace(/[?&=#]/g, "_").replace(/\//g, "-") || "home").slice(0, 80);
}

try {
  await ensureLogin();
  for (const p of paths) {
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
    });
    page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${String(error.message).slice(0, 300)}`));
    const started = Date.now();
    let status = "?";
    try {
      const response = await page.goto(base + p, { waitUntil: "load", timeout: 120_000 });
      status = response ? response.status() : "?";
    } catch (error) {
      console.log(`${p}  FAILED TO LOAD: ${error.message}`);
      await page.close();
      continue;
    }
    await page.waitForTimeout(opts.wait);
    const overlay = await page.evaluate(() => {
      const root = document.querySelector("nextjs-portal")?.shadowRoot;
      if (!root) return "";
      const text = [...root.children]
        .filter((el) => !["STYLE", "SCRIPT", "LINK"].includes(el.tagName))
        .map((el) => (el instanceof HTMLElement ? el.innerText : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      return text.slice(0, 800);
    });
    const overflow = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const scroll = document.documentElement.scrollWidth;
      if (scroll <= width + 1) return "";
      const culprits = [...document.querySelectorAll("body *")]
        .filter((el) => el.getBoundingClientRect().right > width + 1 && !el.closest("[data-scroll-x], .overflow-x-auto"))
        .slice(0, 4)
        .map((el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ").slice(0, 3).join(".") : ""}`);
      return `page is ${scroll}px wide in a ${width}px viewport; widest: ${culprits.join(" | ")}`;
    });
    const name = `${slug(p)}-${opts.width}`;
    const files = [];
    if (opts.slices) {
      const total = await page.evaluate(() => document.documentElement.scrollHeight);
      const count = Math.min(8, Math.ceil(total / opts.height));
      for (let i = 0; i < count; i++) {
        const file = path.join(opts.out, `${name}-${i + 1}.png`);
        const height = Math.min(opts.height, total - i * opts.height);
        await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y: i * opts.height, width: opts.width, height } });
        files.push(file);
      }
    } else {
      const file = path.join(opts.out, `${name}.png`);
      await page.screenshot({ path: file, fullPage: !opts.viewport });
      files.push(file);
    }
    console.log(`${p}  status ${status}  ->  ${new URL(page.url()).pathname}  (${Date.now() - started} ms)`);
    console.log(`  title: ${await page.title()}`);
    for (const file of files) console.log(`  saved: ${file}`);
    if (overlay) console.log(`  NEXT.JS OVERLAY: ${overlay}`);
    if (overflow) console.log(`  HORIZONTAL OVERFLOW: ${overflow}`);
    for (const error of consoleErrors.slice(0, 8)) console.log(`  console error: ${error}`);
    await page.close();
  }
} finally {
  await browser.close();
}
