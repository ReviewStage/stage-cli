#!/usr/bin/env node
import { Command } from "commander";
import { runPrep } from "./prep.js";
import { show } from "./show.js";

const program = new Command();

program.name("stagereview").description("Chapter-style code review against your local git branch.");

program
	.command("prep")
	.description("Parse the current branch diff and prepare input for chapter generation")
	.action(() => {
		const filePath = runPrep();
		process.stdout.write(filePath);
	});

program
	.command("show")
	.description("Load a chapters.json file and open it in a local browser")
	.argument("<path>", "Path to a chapters.json file")
	.action(async (jsonPath: string) => {
		await show(jsonPath);
	});

program.parseAsync(process.argv).catch((err) => {
	process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
	process.exit(1);
});
