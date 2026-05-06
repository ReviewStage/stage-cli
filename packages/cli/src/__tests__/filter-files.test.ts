import type { Hunk, PullRequestFile } from "@stagereview/types/parsed-diff";
import { LINE_TYPE } from "@stagereview/types/parsed-diff";
import { describe, expect, it } from "vitest";
import { filterFilesForLlm, shouldIncludeFile } from "../filter-files.js";

function makeHunk(lineCount: number, overrides?: Partial<Hunk>): Hunk {
	return {
		header: `@@ -1,${lineCount} +1,${lineCount} @@`,
		oldStart: 1,
		newStart: 1,
		oldLines: lineCount,
		newLines: lineCount,
		lines: Array.from({ length: lineCount }, (_, i) => ({
			type: LINE_TYPE.ADDITION,
			content: `line ${i}`,
			newLineNumber: i + 1,
		})),
		...overrides,
	};
}

function makeFile(overrides?: Partial<PullRequestFile>): PullRequestFile {
	return {
		path: "src/app.ts",
		filename: "app.ts",
		status: "modified",
		additions: 1,
		deletions: 0,
		hunks: [makeHunk(5)],
		patch: "diff --git ...",
		...overrides,
	};
}

describe("shouldIncludeFile", () => {
	const denylistedFilenames = [
		"package-lock.json",
		"yarn.lock",
		"pnpm-lock.yaml",
		"bun.lockb",
		"bun.lock",
		"composer.lock",
		"Gemfile.lock",
		"Cargo.lock",
		"poetry.lock",
		"Pipfile.lock",
		"go.sum",
		"flake.lock",
		".DS_Store",
		"Thumbs.db",
	];

	it.each(denylistedFilenames)("excludes lockfile/metadata basename %s", (name) => {
		expect(shouldIncludeFile(name)).toBe(false);
	});

	it.each(denylistedFilenames)("excludes %s when nested under a directory", (name) => {
		expect(shouldIncludeFile(`packages/web/${name}`)).toBe(false);
	});

	const denylistedExtensions = [
		"bundle.min.js",
		"styles.min.css",
		"bundle.map",
		"Component.snap",
		"logo.svg",
		"icon.png",
		"photo.jpg",
		"photo.jpeg",
		"sprite.gif",
		"favicon.ico",
		"font.woff",
		"font.woff2",
		"font.ttf",
		"font.eot",
		"video.mp4",
		"video.webm",
		"doc.pdf",
	];

	it.each(denylistedExtensions)("excludes binary/generated extension %s", (name) => {
		expect(shouldIncludeFile(`assets/${name}`)).toBe(false);
	});

	const normalFiles = [
		"src/index.ts",
		"src/app.tsx",
		"server/main.py",
		"README.md",
		"scripts/build.sh",
		"docker-compose.yaml",
	];

	it.each(normalFiles)("includes normal source file %s", (name) => {
		expect(shouldIncludeFile(name)).toBe(true);
	});

	it("is case-insensitive for basenames", () => {
		expect(shouldIncludeFile("Package-Lock.json")).toBe(false);
		expect(shouldIncludeFile(".DS_STORE")).toBe(false);
		expect(shouldIncludeFile("THUMBS.DB")).toBe(false);
	});

	it("is case-insensitive for extensions", () => {
		expect(shouldIncludeFile("assets/icon.PNG")).toBe(false);
		expect(shouldIncludeFile("dist/bundle.Min.Js")).toBe(false);
	});
});

describe("filterFilesForLlm", () => {
	it("returns empty arrays for empty input", () => {
		const result = filterFilesForLlm([]);
		expect(result.files).toEqual([]);
		expect(result.excludedByPath).toEqual([]);
	});

	it("removes denylisted files and reports them in excludedByPath", () => {
		const code = makeFile({ path: "src/app.ts" });
		const lockfile = makeFile({ path: "pnpm-lock.yaml" });
		const image = makeFile({ path: "public/logo.png" });

		const result = filterFilesForLlm([code, lockfile, image]);

		expect(result.files).toHaveLength(1);
		expect(result.files[0]?.path).toBe("src/app.ts");
		expect(result.excludedByPath).toEqual(["pnpm-lock.yaml", "public/logo.png"]);
	});

	it("returns all-denylisted input as empty files with populated excludedByPath", () => {
		const result = filterFilesForLlm([
			makeFile({ path: "pnpm-lock.yaml" }),
			makeFile({ path: "yarn.lock" }),
		]);
		expect(result.files).toEqual([]);
		expect(result.excludedByPath).toEqual(["pnpm-lock.yaml", "yarn.lock"]);
	});
});
