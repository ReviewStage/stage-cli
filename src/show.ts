import fs from "node:fs";
import path from "node:path";
import open from "open";
import { findFreePort } from "./port.js";
import { startServer } from "./server.js";

export async function show(targetPath: string): Promise<void> {
  const resolved = path.resolve(targetPath);
  if (!fs.existsSync(resolved)) {
    process.stderr.write(`File not found: ${targetPath}\n`);
    process.exit(1);
  }

  const port = await findFreePort();
  const handle = await startServer({ port });
  const url = `http://localhost:${port}`;

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
  process.exit(0);
}
