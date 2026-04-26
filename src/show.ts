import fs from "node:fs";
import path from "node:path";
import { findFreePort } from "./port.js";

export async function show(targetPath: string): Promise<void> {
  const resolved = path.resolve(targetPath);
  if (!fs.existsSync(resolved)) {
    process.stderr.write(`File not found: ${targetPath}\n`);
    process.exit(1);
  }

  const port = await findFreePort();
  const url = `http://localhost:${port}`;
  process.stdout.write(`Listening on port ${port}\n`);
  process.stdout.write(`URL: ${url} (server not implemented yet)\n`);
  process.stdout.write("Press Ctrl+C to exit.\n");

  setInterval(() => {}, 1 << 30);
}
