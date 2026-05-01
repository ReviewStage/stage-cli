#!/usr/bin/env node
import { Command } from "commander";
import { show } from "./show.js";

const program = new Command();

program
  .name("stage-cli")
  .description("Chapter-style code review against your local git branch.");

program
  .command("show")
  .description("Serve a chapters JSON file in a local browser")
  .argument("<path>", "Path to the chapters JSON file")
  .action(async (targetPath: string) => {
    await show(targetPath);
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
