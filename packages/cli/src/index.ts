#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command, Option } from "commander";
import { z } from "zod";
import { runPrep } from "./prep.js";
import { WORKING_TREE_REF } from "./schema.js";
import { show } from "./show.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const program = new Command();

program
	.name("stagereview")
	.description("Chapter-style code review against your local git branch.")
	.version(version);

const refOption = new Option(
	"--ref <mode>",
	"Diff scope: work (staged + unstaged + untracked), staged, or unstaged (default: auto-detect)",
).choices(Object.values(WORKING_TREE_REF));

program
	.command("prep")
	.description("Parse the current branch diff and prepare input for chapter generation")
	.option("--base <ref>", "Base ref to diff against (default: auto-detect main/master)")
	.addOption(refOption)
	.action((opts: { base?: string; ref?: string }) => {
		const ref = opts.ref !== undefined ? z.enum(WORKING_TREE_REF).parse(opts.ref) : undefined;
		const filePath = runPrep(opts.base, ref);
		process.stdout.write(filePath);
	});

program
	.command("show")
	.description("Load a chapters.json file and open it in a local browser")
	.argument("<path>", "Path to a chapters.json file")
	.option("--base <ref>", "Base ref to diff against (default: auto-detect main/master)")
	.addOption(refOption)
	.action(async (jsonPath: string, opts: { base?: string; ref?: string }) => {
		const ref = opts.ref !== undefined ? z.enum(WORKING_TREE_REF).parse(opts.ref) : undefined;
		await show(jsonPath, opts.base, ref);
	});

program.parseAsync(process.argv).catch((err) => {
	process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
	process.exit(1);
});
