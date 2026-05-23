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

interface DiffCommandOptions {
	base?: string;
	compare?: string;
	ref?: string;
}

function parseWorkingTreeRef(workingTreeRef?: string) {
	return workingTreeRef !== undefined ? z.enum(WORKING_TREE_REF).parse(workingTreeRef) : undefined;
}

function readWorkingTreeRef(options: DiffCommandOptions) {
	return parseWorkingTreeRef(options.ref);
}

program
	.command("prep")
	.description("Parse the current branch diff and prepare input for chapter generation")
	.argument("[refs...]", "Git refs to diff, for example: main, main feature, or main..feature")
	.option("--base <ref>", "Base ref to diff against (default: auto-detect main/master)")
	.option("--compare <ref>", "Compare ref to diff against --base")
	.addOption(refOption)
	.action((refs: string[], opts: DiffCommandOptions) => {
		const workingTreeRef = readWorkingTreeRef(opts);
		const filePath = runPrep(opts.base, workingTreeRef, refs, opts.compare);
		process.stdout.write(filePath);
	});

program
	.command("show")
	.description("Load a chapters.json file and open it in a local browser")
	.argument("<path>", "Path to a chapters.json file")
	.argument("[refs...]", "Git refs to diff, for example: main, main feature, or main..feature")
	.option("--base <ref>", "Base ref to diff against (default: auto-detect main/master)")
	.option("--compare <ref>", "Compare ref to diff against --base")
	.addOption(refOption)
	.action(async (jsonPath: string, refs: string[], opts: DiffCommandOptions) => {
		const workingTreeRef = readWorkingTreeRef(opts);
		await show(jsonPath, opts.base, workingTreeRef, refs, opts.compare);
	});

program.parseAsync(process.argv).catch((err) => {
	process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
	process.exit(1);
});
