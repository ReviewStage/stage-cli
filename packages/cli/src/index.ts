#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command } from "commander";
import { commentsCommand } from "./comments/command.js";
import {
	addDiffScopeOptions,
	type DiffCommandOptions,
	toDiffScopeOptions,
} from "./diff-scope-options.js";
import { runPrep } from "./prep.js";
import { show } from "./show.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const program = new Command();

program
	.name("stagereview")
	.description("Chapter-style code review against your local git branch.")
	.version(version);

interface PrepCommandOptions extends DiffCommandOptions {
	instructions?: string;
}

addDiffScopeOptions(
	program
		.command("prep")
		.description("Parse the current branch diff and prepare input for chapter generation"),
)
	.option(
		"--instructions <text>",
		"One-off instructions appended to the generation prompt (max 1000 characters)",
	)
	.action(async (refs: string[], opts: PrepCommandOptions) => {
		const filePath = await runPrep({
			...toDiffScopeOptions(refs, opts),
			instructions: opts.instructions,
		});
		process.stdout.write(filePath);
	});

addDiffScopeOptions(
	program
		.command("show")
		.description("Load a chapters.json file and open it in a local browser")
		.argument("<path>", "Path to a chapters.json file"),
).action(async (jsonPath: string, refs: string[], opts: DiffCommandOptions) => {
	await show(jsonPath, toDiffScopeOptions(refs, opts));
});

program.addCommand(commentsCommand());

program.parseAsync(process.argv).catch((err) => {
	process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
	process.exit(1);
});
