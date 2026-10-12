/*
  Runs once when a server process starts. It starts the scan worker, which
  resumes queued jobs left by a restart (for example a scan that was running
  when the server stopped). Never during `next build`: the build must not open
  the database.
*/
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.TRUECITE_WORKER === "off") return;

  const { ensureWorker } = await import("@/lib/engine");
  // Start after the server is ready to take requests; the worker opens the database itself.
  const timer = setTimeout(() => {
    try {
      ensureWorker();
    } catch (error) {
      console.error(`[engine] the scan worker did not start: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, 1_000);
  timer.unref?.();
}
