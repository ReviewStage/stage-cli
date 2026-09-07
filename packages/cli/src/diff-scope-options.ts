import { type Command, Option } from "commander";
import { z } from "zod";
import { WORKING_TREE_REF } from "./schema.js";
import type { DiffScopeOptions } from "./scope.js";

/** The raw diff-scope flags Commander collects for any command that addresses a diff. */
export interface DiffCommandOptions {
	base?: string;
	compare?: string;
	ref?: string;
	pr?: string;
}

/**
 * Register the shared diff-scope surface — a trailing `[refs...]` argument plus
 * `--base`, `--compare`, `--pr`, and `--ref` — on a command. Every command that
 * targets a diff (`prep`, `show`, `comments`) uses this so they all accept the
 * same selectors and resolve the same scope.
 */
export function addDiffScopeOptions(command: Command): Command {
	return command
		.argument("[refs...]", "Git refs to diff, for example: main, main feature, or main..feature")
		.option("--base <ref>", "Base ref to diff against (default: auto-detect main/master)")
		.option("--compare <ref>", "Compare ref to diff against --base")
		.option("--pr <ref>", "Review a GitHub pull request by number or URL")
		.addOption(
			new Option(
				"--ref <mode>",
				"Diff scope: work (staged + unstaged + untracked), staged, or unstaged (default: auto-detect)",
			).choices(Object.values(WORKING_TREE_REF)),
		);
}

/**
 * Build the diff scope from CLI input. `--pr` resolves the base/head from a
 * GitHub PR and so can't be combined with the local-ref selectors.
 */
export function toDiffScopeOptions(refs: string[], opts: DiffCommandOptions): DiffScopeOptions {
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
