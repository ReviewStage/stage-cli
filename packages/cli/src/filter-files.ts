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
 * blank lines and `#` comments are ignored. Prefix a pattern with `!`
 * to negate (re-include) a previously excluded match.
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

interface CompiledPattern {
	negated: boolean;
	matcher: picomatch.Matcher;
}

/**
 * Pre-compile `.stageignore` patterns into matchers. Patterns without a
 * slash use `matchBase` so bare globs like `*.generated.ts` match in
 * subdirectories. Patterns with a slash match the full path. Patterns
 * prefixed with `!` negate a previous match (`.gitignore` semantics:
 * last matching pattern wins).
 */
export function compileIgnorePatterns(patterns: string[]): CompiledPattern[] {
	return patterns.map((raw) => {
		const negated = raw.startsWith("!");
		const glob = negated ? raw.slice(1) : raw;
		const hasSlash = glob.includes("/");
		return {
			negated,
			matcher: picomatch(glob, { dot: true, matchBase: !hasSlash }),
		};
	});
}

function isIgnoredByPatterns(filePath: string, compiled: CompiledPattern[]): boolean {
	let ignored = false;
	for (const { negated, matcher } of compiled) {
		if (matcher(filePath)) {
			ignored = !negated;
		}
	}
	return ignored;
}

export interface FilterFilesResult {
	files: PullRequestFile[];
	excludedByPath: string[];
}

export function filterFilesForLlm(
	files: PullRequestFile[],
	stageIgnorePatterns?: string[],
): FilterFilesResult {
	const compiled =
		stageIgnorePatterns && stageIgnorePatterns.length > 0
			? compileIgnorePatterns(stageIgnorePatterns)
			: null;

	const excludedByPath: string[] = [];
	const reviewable: PullRequestFile[] = [];

	for (const file of files) {
		if (!shouldIncludeFile(file.path) || (compiled && isIgnoredByPatterns(file.path, compiled))) {
			excludedByPath.push(file.path);
			continue;
		}
		reviewable.push(file);
	}

	return { files: reviewable, excludedByPath };
}
