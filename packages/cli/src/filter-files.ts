import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { PullRequestFile } from "@stagereview/types/parsed-diff";
import picomatch from "picomatch";

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
 * Load exclusion patterns from a `.stageignore` file in the repo root.
 * Format follows `.gitignore` conventions: one glob pattern per line,
 * blank lines and `#` comments are ignored.
 */
export function loadStageIgnorePatterns(repoRoot: string): string[] {
	const ignorePath = path.join(repoRoot, ".stageignore");
	if (!existsSync(ignorePath)) return [];
	const content = readFileSync(ignorePath, "utf8");
	return content
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "" && !line.startsWith("#"));
}

export interface FilterFilesResult {
	files: PullRequestFile[];
	excludedByPath: string[];
}

export function filterFilesForLlm(
	files: PullRequestFile[],
	stageIgnorePatterns?: string[],
): FilterFilesResult {
	let isIgnored: ((path: string) => boolean) | null = null;
	if (stageIgnorePatterns && stageIgnorePatterns.length > 0) {
		const withSlash = stageIgnorePatterns.filter((p) => p.includes("/"));
		const withoutSlash = stageIgnorePatterns.filter((p) => !p.includes("/"));
		const matchers: picomatch.Matcher[] = [];
		if (withSlash.length > 0) matchers.push(picomatch(withSlash, { dot: true }));
		if (withoutSlash.length > 0)
			matchers.push(picomatch(withoutSlash, { dot: true, matchBase: true }));
		isIgnored = (p: string) => matchers.some((m) => m(p));
	}

	const excludedByPath: string[] = [];
	const reviewable: PullRequestFile[] = [];

	for (const file of files) {
		if (!shouldIncludeFile(file.path) || isIgnored?.(file.path)) {
			excludedByPath.push(file.path);
			continue;
		}
		reviewable.push(file);
	}

	return { files: reviewable, excludedByPath };
}
