#!/usr/bin/env node
/*
  Deletes the local PGlite database so the next start re-creates it and loads
  the demo data again. Stop the dev server first: only one process may open
  the database at a time.
*/
import fs from "node:fs";
import path from "node:path";

const dir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
if (fs.existsSync(dir)) {
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`Deleted ${dir}. Start the app to load the demo data again.`);
} else {
  console.log(`No database at ${dir}. Nothing to delete.`);
}
