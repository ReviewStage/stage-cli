import { eq } from "drizzle-orm";
import open from "open";
import { closeDb, getDb } from "./db/client.js";
import { chapterRun } from "./db/schema/index.js";
import { runRoutes } from "./routes/runs.js";
import { LOOPBACK_HOST, startServer } from "./server.js";

export async function show(runId?: string): Promise<void> {
  const db = getDb();

  if (runId !== undefined) {
    const exists = db
      .select({ id: chapterRun.id })
      .from(chapterRun)
      .where(eq(chapterRun.id, runId))
      .get();
    if (!exists) throw new Error(`Run ${runId} not found`);
  }

  const handle = await startServer({ routes: runRoutes(db) });
  const { port } = handle;
  // Pass the runId through the URL hash so the SPA can pick it up. Falls back to the latest
  // run (the SPA hits /api/runs/latest when no fragment is present).
  const url = runId
    ? `http://${LOOPBACK_HOST}:${port}/#/runs/${runId}`
    : `http://${LOOPBACK_HOST}:${port}`;

  process.stdout.write(`Listening on ${url}\n`);
  process.stdout.write("Press Ctrl+C to exit.\n");

  try {
    await open(url);
  } catch {
    // URL is on stdout — user can navigate manually.
  }

  await waitForShutdownSignal();

  await handle.close();
  closeDb();
}

function waitForShutdownSignal(): Promise<void> {
  return new Promise<void>((resolve) => {
    const cleanup = () => {
      process.removeListener("SIGINT", cleanup);
      process.removeListener("SIGTERM", cleanup);
      resolve();
    };

    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  });
}
