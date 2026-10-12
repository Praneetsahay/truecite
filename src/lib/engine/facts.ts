import "server-only";
import { eq } from "drizzle-orm";
import { brands, facts, getDb } from "@/lib/db";
import { crawlSite } from "./crawler";
import { EngineError } from "./errors";
import { checkerAvailable, draftFromPages, extractFactsWithModel, type DraftFact } from "./extract";
import { getSettings } from "./settings";

/*
  Reads the public pages of the brand's website (home, about, pricing, products,
  leadership, policy and press pages) and drafts Fact Sheet entries with status
  "draft" for the client to approve.

  With an Anthropic key, the checker model extracts the facts. Without one, or
  when the site cannot be read, a deterministic draft states only what can be
  derived safely, and the result says so with `simulated: true`. Statements that
  already exist are skipped, so running it twice is safe.
*/

/** Comparison key for duplicate statements: case, spacing and the closing full stop do not matter. */
function statementKey(statement: string): string {
  return statement
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/, "")
    .trim();
}

export async function draftFactSheet(brandId: string): Promise<{ created: number; pagesRead: string[]; simulated: boolean }> {
  const db = await getDb();
  const [brand] = await db
    .select({
      id: brands.id,
      organizationId: brands.organizationId,
      name: brands.name,
      website: brands.website,
      description: brands.description,
      industry: brands.industry,
    })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  if (!brand) throw new EngineError("This company could not be found. Reload the page and try again.");

  const crawl = await crawlSite(brand.website);
  const pagesRead = crawl.pages.map((page) => page.url);

  let drafted: DraftFact[] | null = null;
  let simulated = true;
  if (crawl.pages.length > 0) {
    const settings = await getSettings();
    if (checkerAvailable(settings)) {
      try {
        drafted = await extractFactsWithModel({ settings, brand, pages: crawl.pages });
        if (drafted) simulated = false;
      } catch (error) {
        // Fall back to the deterministic draft, so the client still gets a starting point.
        console.warn("[facts] The checker model could not draft facts:", error instanceof Error ? error.message : error);
        drafted = null;
      }
    }
  }
  if (!drafted) drafted = draftFromPages(brand, crawl.pages);

  const existing = await db.select({ statement: facts.statement }).from(facts).where(eq(facts.brandId, brandId));
  const known = new Set(existing.map((row) => statementKey(row.statement)));
  const rows: DraftFact[] = [];
  for (const fact of drafted) {
    const key = statementKey(fact.statement);
    if (!key || known.has(key)) continue;
    known.add(key);
    rows.push(fact);
  }

  if (rows.length > 0) {
    await db.insert(facts).values(
      rows.map((fact) => ({
        brandId,
        category: fact.category,
        statement: fact.statement,
        importance: fact.importance,
        sourceUrl: fact.sourceUrl,
        validFrom: fact.validFrom,
        status: "draft" as const,
        origin: "website" as const,
      })),
    );
  }

  return { created: rows.length, pagesRead, simulated };
}
