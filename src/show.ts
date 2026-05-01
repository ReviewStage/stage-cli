import open from "open";
import { closeDb, getDb } from "./db/client.js";
import { runRoutes } from "./routes/runs.js";
import { LOOPBACK_HOST, startServer } from "./server.js";

export async function show(_runId?: string): Promise<void> {
  const db = getDb();
  const handle = await startServer({ routes: runRoutes(db) });
  const { port } = handle;
  const url = `http://${LOOPBACK_HOST}:${port}`;

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
