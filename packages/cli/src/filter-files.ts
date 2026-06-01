import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { PullRequestFile } from "@stagereview/types/parsed-diff";
import ignore, { type Ignore } from "ignore";

const IGNORED_FILENAMES = new Set([
	"package-lock.json",
	"yarn.lock",
	"pnpm-lock.yaml",
	"bun.lockb",
	"bun.lock",
	"composer.lock",
	"gemfile.lock",
	"cargo.lock",
	"poetry.lock",
	"pipfile.lock",
	"go.sum",
	"flake.lock",
	".ds_store",
	"thumbs.db",
]);

const IGNORED_EXTENSIONS = [
	".min.js",
	".min.css",
	".map",
	".snap",
	".svg",
	".png",
	".jpg",
	".jpeg",
	".gif",
	".ico",
	".woff",
	".woff2",
	".ttf",
	".eot",
	".mp4",
	".webm",
	".pdf",
] as const;

export function shouldIncludeFile(filePath: string): boolean {
	const basename = (filePath.split("/").at(-1) ?? filePath).toLowerCase();
	if (IGNORED_FILENAMES.has(basename)) return false;
	const lowerPath = filePath.toLowerCase();
	return !IGNORED_EXTENSIONS.some((ext) => lowerPath.endsWith(ext));
}

/**
 * Load a `.stageignore` file from the repo root into an `Ignore` matcher.
 * Returns `null` when the file is absent. Parsing, comments, blank lines,
 * negation, and anchoring semantics all follow `.gitignore` via the
 * `ignore` package.
 */
export function loadStageIgnore(repoRoot: string): Ignore | null {
	const ignorePath = path.join(repoRoot, ".stageignore");
	if (!existsSync(ignorePath)) return null;
	return ignore().add(readFileSync(ignorePath, "utf8"));
}

export interface FilterFilesResult {
	files: PullRequestFile[];
	excludedByPath: string[];
}

export function filterFilesForLlm(
	files: PullRequestFile[],
	stageIgnore?: Ignore | null,
): FilterFilesResult {
	const excludedByPath: string[] = [];
	const reviewable: PullRequestFile[] = [];

	for (const file of files) {
		if (!shouldIncludeFile(file.path) || stageIgnore?.ignores(file.path)) {
			excludedByPath.push(file.path);
			continue;
		}
		reviewable.push(file);
	}

	return { files: reviewable, excludedByPath };
}
