import "server-only";
import type { Browser } from "playwright-core";
import { EngineError } from "./errors";

/*
  Renders a report's print view to PDF with a local Chrome or Edge through
  playwright-core, so the PDF looks exactly like the web report. CHROME_PATH
  points at a specific browser binary when neither channel is installed.
*/

async function launchBrowser(): Promise<Browser | null> {
  const { chromium } = await import("playwright-core");
  const attempts: (() => Promise<Browser>)[] = [];
  const executablePath = process.env.CHROME_PATH?.trim();
  if (executablePath) attempts.push(() => chromium.launch({ executablePath, headless: true }));
  attempts.push(() => chromium.launch({ channel: "chrome", headless: true }));
  attempts.push(() => chromium.launch({ channel: "msedge", headless: true }));
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch {
      // try the next browser
    }
  }
  return null;
}

/** "a=1; b=2" as cookies scoped to the report's own origin, so they are never sent anywhere else. */
function parseCookies(header: string, url: string): { name: string; value: string; url: string }[] {
  const origin = new URL(url).origin;
  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf("=");
      return eq === -1 ? null : { name: part.slice(0, eq).trim(), value: part.slice(eq + 1).trim(), url: origin };
    })
    .filter((cookie): cookie is { name: string; value: string; url: string } => cookie !== null && cookie.name.length > 0);
}

/** Returns the PDF bytes, or null when no browser can be started on this machine. */
export async function renderPdf(input: { url: string; cookieHeader?: string }): Promise<Uint8Array | null> {
  let target: URL;
  try {
    target = new URL(input.url);
  } catch {
    throw new EngineError("The report address is not valid.");
  }
  const browser = await launchBrowser();
  if (!browser) return null;
  try {
    const context = await browser.newContext({ reducedMotion: "reduce", colorScheme: "light" });
    if (input.cookieHeader) {
      // Same effect as sending the Cookie header, without leaking it to other hosts the page loads from.
      await context.addCookies(parseCookies(input.cookieHeader, target.toString()));
    }
    const page = await context.newPage();
    let response;
    try {
      response = await page.goto(target.toString(), { waitUntil: "networkidle", timeout: 60_000 });
    } catch {
      throw new EngineError("The report page could not be loaded for the PDF. Check that the app is running, then try again.");
    }
    if (response && !response.ok()) {
      throw new EngineError(`The report page could not be opened for the PDF (status ${response.status()}). Open the report and try again.`);
    }
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", right: "16mm", bottom: "16mm", left: "16mm" },
    });
    return new Uint8Array(pdf);
  } finally {
    await browser.close().catch(() => undefined);
  }
}
