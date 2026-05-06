import type { PullRequestFile } from "@stagereview/types/parsed-diff";

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

export interface FilterFilesResult {
	files: PullRequestFile[];
	excludedByPath: string[];
}

export function filterFilesForLlm(files: PullRequestFile[]): FilterFilesResult {
	const excludedByPath: string[] = [];
	const reviewable: PullRequestFile[] = [];

	for (const file of files) {
		if (!shouldIncludeFile(file.path)) {
			excludedByPath.push(file.path);
			continue;
		}
		reviewable.push(file);
	}

	return { files: reviewable, excludedByPath };
}
