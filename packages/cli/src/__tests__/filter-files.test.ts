import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Hunk, PullRequestFile } from "@stagereview/types/parsed-diff";
import { LINE_TYPE } from "@stagereview/types/parsed-diff";
import ignore from "ignore";
import { describe, expect, it } from "vitest";
import { filterFilesForLlm, loadStageIgnore, shouldIncludeFile } from "../filter-files.js";

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

function ig(patterns: string[]) {
	return ignore().add(patterns);
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

	it("excludes files matching .stageignore patterns", () => {
		const files = [
			makeFile({ path: "src/app.ts" }),
			makeFile({ path: "build/config.gypi" }),
			makeFile({ path: "dist/bundle.js" }),
		];
		const result = filterFilesForLlm(files, ig(["build/**", "dist/**"]));
		expect(result.files).toHaveLength(1);
		expect(result.files[0]?.path).toBe("src/app.ts");
		expect(result.excludedByPath).toEqual(["build/config.gypi", "dist/bundle.js"]);
	});

	it("combines built-in denylist with .stageignore patterns", () => {
		const files = [
			makeFile({ path: "src/app.ts" }),
			makeFile({ path: "pnpm-lock.yaml" }),
			makeFile({ path: "generated/schema.ts" }),
		];
		const result = filterFilesForLlm(files, ig(["generated/**"]));
		expect(result.files).toHaveLength(1);
		expect(result.files[0]?.path).toBe("src/app.ts");
		expect(result.excludedByPath).toEqual(["pnpm-lock.yaml", "generated/schema.ts"]);
	});

	it("works normally when stageIgnore is undefined", () => {
		const files = [makeFile({ path: "src/app.ts" }), makeFile({ path: "pnpm-lock.yaml" })];
		const result = filterFilesForLlm(files, undefined);
		expect(result.files).toHaveLength(1);
		expect(result.files[0]?.path).toBe("src/app.ts");
	});

	it("works normally when stageIgnore is null", () => {
		const files = [makeFile({ path: "src/app.ts" }), makeFile({ path: "src/utils.ts" })];
		const result = filterFilesForLlm(files, null);
		expect(result.files).toHaveLength(2);
	});

	it("slashless globs match nested paths", () => {
		const files = [
			makeFile({ path: "src/app.ts" }),
			makeFile({ path: "src/schema.generated.ts" }),
			makeFile({ path: "lib/deep/nested/types.generated.ts" }),
		];
		const result = filterFilesForLlm(files, ig(["*.generated.ts"]));
		expect(result.files).toHaveLength(1);
		expect(result.files[0]?.path).toBe("src/app.ts");
	});

	it("negation re-includes a previously excluded file", () => {
		const files = [
			makeFile({ path: "build/output.js" }),
			makeFile({ path: "build/important.js" }),
			makeFile({ path: "src/app.ts" }),
		];
		const result = filterFilesForLlm(files, ig(["build/**", "!build/important.js"]));
		expect(result.files).toHaveLength(2);
		expect(result.files.map((f) => f.path)).toEqual(["build/important.js", "src/app.ts"]);
	});

	it("last matching pattern wins with negation", () => {
		const files = [makeFile({ path: "dist/bundle.js" })];
		const result = filterFilesForLlm(files, ig(["dist/**", "!dist/bundle.js", "*.js"]));
		expect(result.files).toHaveLength(0);
	});

	it("leading slash anchors a pattern to the repo root", () => {
		const files = [makeFile({ path: "dist/bundle.js" }), makeFile({ path: "src/app.ts" })];
		const result = filterFilesForLlm(files, ig(["/dist/**"]));
		expect(result.files).toHaveLength(1);
		expect(result.files[0]?.path).toBe("src/app.ts");
	});

	it("root-anchored pattern does not match nested paths", () => {
		const files = [makeFile({ path: "foo/bar.js" }), makeFile({ path: "src/foo/bar.js" })];
		const result = filterFilesForLlm(files, ig(["/foo/**"]));
		expect(result.files).toHaveLength(1);
		expect(result.files[0]?.path).toBe("src/foo/bar.js");
	});

	it("trailing slash matches directory contents", () => {
		const files = [makeFile({ path: "build/output.js" }), makeFile({ path: "src/app.ts" })];
		const result = filterFilesForLlm(files, ig(["build/"]));
		expect(result.files).toHaveLength(1);
		expect(result.files[0]?.path).toBe("src/app.ts");
	});

	it("negation with slashless pattern re-includes nested files", () => {
		const files = [
			makeFile({ path: "generated/schema.ts" }),
			makeFile({ path: "generated/keep-this.ts" }),
		];
		const result = filterFilesForLlm(files, ig(["generated/**", "!keep-this.ts"]));
		expect(result.files).toHaveLength(1);
		expect(result.files[0]?.path).toBe("generated/keep-this.ts");
	});
});

describe("loadStageIgnore", () => {
	function makeTempDir(): string {
		return mkdtempSync(path.join(tmpdir(), "stage-test-"));
	}

	it("returns null when .stageignore does not exist", () => {
		const dir = makeTempDir();
		expect(loadStageIgnore(dir)).toBeNull();
	});

	it("parses patterns from .stageignore", () => {
		const dir = makeTempDir();
		writeFileSync(path.join(dir, ".stageignore"), "build/**\ndist/**\n");
		const matcher = loadStageIgnore(dir);
		expect(matcher).not.toBeNull();
		expect(matcher?.ignores("build/config.gypi")).toBe(true);
		expect(matcher?.ignores("dist/bundle.js")).toBe(true);
		expect(matcher?.ignores("src/app.ts")).toBe(false);
	});

	it("ignores comments and blank lines", () => {
		const dir = makeTempDir();
		writeFileSync(
			path.join(dir, ".stageignore"),
			"# Build artifacts\nbuild/**\n\n# Output\ndist/**\n\n",
		);
		const matcher = loadStageIgnore(dir);
		expect(matcher?.ignores("build/config.gypi")).toBe(true);
		expect(matcher?.ignores("dist/bundle.js")).toBe(true);
		expect(matcher?.ignores("src/app.ts")).toBe(false);
	});

	it("empty .stageignore matches nothing", () => {
		const dir = makeTempDir();
		writeFileSync(path.join(dir, ".stageignore"), "");
		const matcher = loadStageIgnore(dir);
		expect(matcher).not.toBeNull();
		expect(matcher?.ignores("src/app.ts")).toBe(false);
		expect(matcher?.ignores("build/anything.js")).toBe(false);
	});
});
