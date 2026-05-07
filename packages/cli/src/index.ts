#!/usr/bin/env node
import { Command } from "commander";
import { runPrep } from "./prep.js";
import { show } from "./show.js";

const program = new Command();

program.name("stagereview").description("Chapter-style code review against your local git branch.");

program
	.command("prep")
	.description("Parse the current branch diff and prepare input for chapter generation")
	.option("--base <ref>", "Base ref to diff against (default: auto-detect main/master)")
	.action((opts: { base?: string }) => {
		const filePath = runPrep(opts.base);
		process.stdout.write(filePath);
	});

program
	.command("show")
	.description("Load a chapters.json file and open it in a local browser")
	.argument("<path>", "Path to a chapters.json file")
	.option("--base <ref>", "Base ref to diff against (default: auto-detect main/master)")
	.action(async (jsonPath: string, opts: { base?: string }) => {
		await show(jsonPath, opts.base);
	});

program.parseAsync(process.argv).catch((err) => {
	process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
	process.exit(1);
});
