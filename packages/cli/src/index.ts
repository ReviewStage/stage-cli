#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command, Option } from "commander";
import { z } from "zod";
import { runPrep } from "./prep.js";
import { WORKING_TREE_REF } from "./schema.js";
import type { DiffScopeOptions } from "./scope.js";
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
	pr?: string;
}

/**
 * Build the diff scope from CLI input. `--pr` resolves the base/head from a
 * GitHub PR and so can't be combined with the local-ref selectors.
 */
function toDiffScopeOptions(refs: string[], opts: DiffCommandOptions): DiffScopeOptions {
	if (opts.pr !== undefined) {
		if (
			refs.length > 0 ||
			opts.base !== undefined ||
			opts.compare !== undefined ||
			opts.ref !== undefined
		) {
			throw new Error("--pr cannot be combined with git refs, --base, --compare, or --ref.");
		}
		return { pr: opts.pr };
	}
	const workingTreeRef =
		opts.ref !== undefined ? z.enum(WORKING_TREE_REF).parse(opts.ref) : undefined;
	return { base: opts.base, compare: opts.compare, refs, workingTreeRef };
}

program
	.command("prep")
	.description("Parse the current branch diff and prepare input for chapter generation")
	.argument("[refs...]", "Git refs to diff, for example: main, main feature, or main..feature")
	.option("--base <ref>", "Base ref to diff against (default: auto-detect main/master)")
	.option("--compare <ref>", "Compare ref to diff against --base")
	.option("--pr <ref>", "Review a GitHub pull request by number or URL")
	.addOption(refOption)
	.action(async (refs: string[], opts: DiffCommandOptions) => {
		const filePath = await runPrep(toDiffScopeOptions(refs, opts));
		process.stdout.write(filePath);
	});

program
	.command("show")
	.description("Load a chapters.json file and open it in a local browser")
	.argument("<path>", "Path to a chapters.json file")
	.argument("[refs...]", "Git refs to diff, for example: main, main feature, or main..feature")
	.option("--base <ref>", "Base ref to diff against (default: auto-detect main/master)")
	.option("--compare <ref>", "Compare ref to diff against --base")
	.option("--pr <ref>", "Review a GitHub pull request by number or URL")
	.addOption(refOption)
	.action(async (jsonPath: string, refs: string[], opts: DiffCommandOptions) => {
		await show(jsonPath, toDiffScopeOptions(refs, opts));
	});

program.parseAsync(process.argv).catch((err) => {
	process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
	process.exit(1);
});
