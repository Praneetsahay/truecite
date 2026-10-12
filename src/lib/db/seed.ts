import "server-only";
import type { Database } from "./client";
import { organizations, settings } from "./schema";
import { seedAcme } from "./seed/acme";
import { seedActivity } from "./seed/activity";
import { seedOtherClients } from "./seed/others";
import { seedPeople } from "./seed/people";
import { seedProspects } from "./seed/prospects";
import { settingsRows } from "./seed/settings";
import { computeAnchor, idFactory, insertRows, istDay, type SeedContext } from "./seed/util";

/*
  The demo dataset, written once on first boot when the database has no organizations.
  Everything is deterministic (seeded PRNG, fixed ids) and dated relative to the anchor:
  the most recent 06:00 IST, when Acme's latest weekly scan finished.
*/

export type SeedResult = {
  anchor: Date;
  acme: Awaited<ReturnType<typeof seedAcme>>;
};

export async function seedIfEmpty(db: Database): Promise<void> {
  await seedDemo(db);
}

/** Seeds the demo data and returns a summary, or null when the database already has data. */
export async function seedDemo(db: Database, now = new Date()): Promise<SeedResult | null> {
  const existing = await db.select({ id: organizations.id }).from(organizations).limit(1);
  if (existing.length > 0) return null;

  const anchor = computeAnchor(now);
  return db.transaction(async (tx) => {
    const ctx: SeedContext = { db: tx, now, anchor, anchorDay: istDay(anchor), newId: idFactory("truecite-demo") };
    await insertRows(tx, settings, settingsRows(anchor));
    const people = await seedPeople(ctx);
    const acme = await seedAcme(ctx, people);
    await seedOtherClients(ctx, people);
    await seedProspects(ctx, people);
    await seedActivity(ctx, people, acme);
    return { anchor, acme };
  });
}
