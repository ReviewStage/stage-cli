import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { PullRequestFile } from "@stagereview/types/parsed-diff";
import ignore from "ignore";
import { DEFAULT_IGNORE_PATTERNS } from "./ignore-patterns.js";

export { DEFAULT_IGNORE_PATTERNS, DEFAULT_IGNORE_PATTERNS_TEXT } from "./ignore-patterns.js";

function buildIgnoreFilter(ignorePatterns: string | null): ReturnType<typeof ignore> {
	const ig = ignore({ ignoreCase: true });
	ig.add([...DEFAULT_IGNORE_PATTERNS]);
	if (ignorePatterns) {
		ig.add(ignorePatterns);
	}
	return ig;
}

export function shouldIncludeFile(filePath: string, ignorePatterns?: string | null): boolean {
	const ig = buildIgnoreFilter(ignorePatterns ?? null);
	return !ig.ignores(filePath);
}

/**
 * Load a `.stageignore` file from the repo root. Returns its raw pattern text,
 * or `null` when the file is absent. The patterns are layered on top of
 * {@link DEFAULT_IGNORE_PATTERNS} in one matcher, so `!` negations can
 * re-include default-ignored files. Comments, blank lines, negation, and
 * anchoring semantics all follow `.gitignore` via the `ignore` package.
 */
export function loadStageIgnore(repoRoot: string): string | null {
	const ignorePath = path.join(repoRoot, ".stageignore");
	if (!existsSync(ignorePath)) return null;
	return readFileSync(ignorePath, "utf8");
}

export interface FilterFilesResult {
	files: PullRequestFile[];
	excludedByPath: string[];
}

export function filterFilesForLlm(
	files: PullRequestFile[],
	ignorePatterns?: string | null,
): FilterFilesResult {
	const ig = buildIgnoreFilter(ignorePatterns ?? null);
	const excludedByPath: string[] = [];
	const reviewable: PullRequestFile[] = [];

	for (const file of files) {
		if (ig.ignores(file.path)) {
			excludedByPath.push(file.path);
			continue;
		}
		reviewable.push(file);
	}

	return { files: reviewable, excludedByPath };
}
