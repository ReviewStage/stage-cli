#!/usr/bin/env node
import { Command } from "commander";
import { show } from "./show.js";

const program = new Command();

program
  .name("stage-cli")
  .description("Chapter-style code review against your local git branch.");

program
  .command("show")
  .description("Serve the Stage CLI SPA in a local browser")
  .argument("[runId]", "Run ID to show (defaults to the latest run once ingest is available)")
  .action(async (runId?: string) => {
    await show(runId);
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
