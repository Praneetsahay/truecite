import "server-only";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";

/*
  Local development runs on PGlite, an embedded Postgres kept in .data/pglite,
  so the app works with no setup. Set DATABASE_URL to use a real Postgres such as
  Supabase instead; the schema and every query stay the same.
*/

export type Database = PgliteDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __trueciteDb?: Promise<Database> };

async function openPglite(): Promise<Database> {
  const dir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  fs.mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  const { seedIfEmpty } = await import("./seed");
  await seedIfEmpty(db);
  return db;
}

async function openPostgres(url: string): Promise<Database> {
  const [{ default: postgres }, { drizzle: drizzlePostgres }] = await Promise.all([
    import("postgres"),
    import("drizzle-orm/postgres-js"),
  ]);
  const client = postgres(url, { prepare: false, max: 10 });
  // Same query API; migrations run with `npm run db:migrate` against this database.
  return drizzlePostgres(client, { schema }) as unknown as Database;
}

/** The shared database handle. Safe to call from server components, actions, route handlers and jobs. */
export function getDb(): Promise<Database> {
  if (!globalForDb.__trueciteDb) {
    const url = process.env.DATABASE_URL;
    globalForDb.__trueciteDb = (url ? openPostgres(url) : openPglite()).catch((error: unknown) => {
      globalForDb.__trueciteDb = undefined;
      throw error;
    });
  }
  return globalForDb.__trueciteDb;
}
