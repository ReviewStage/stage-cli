import open from "open";
import { startServer } from "./server.js";

export async function show(_runId?: string): Promise<void> {
  const handle = await startServer({});
  const { port } = handle;
  const url = `http://127.0.0.1:${port}`;

  process.stdout.write(`Listening on ${url}\n`);
  process.stdout.write("Press Ctrl+C to exit.\n");

  try {
    await open(url);
  } catch {
    // URL is on stdout — user can navigate manually.
  }

  await new Promise<void>((resolve) => {
    process.once("SIGINT", () => resolve());
  });

  await handle.close();
}
