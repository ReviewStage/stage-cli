import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Hunk, PullRequestFile } from "@stagereview/types/parsed-diff";
import { LINE_TYPE } from "@stagereview/types/parsed-diff";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_IGNORE_PATTERNS,
	DEFAULT_IGNORE_PATTERNS_TEXT,
	filterFilesForLlm,
	loadStageIgnore,
	shouldIncludeFile,
} from "../filter-files.js";

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
		"uv.lock",
		"deno.lock",
		"pubspec.lock",
		"Podfile.lock",
		"mix.lock",
		"npm-shrinkwrap.json",
		"gradle.lockfile",
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

	it("applies custom ignore patterns on top of defaults", () => {
		const result = filterFilesForLlm(
			[
				makeFile({ path: "src/app.ts" }),
				makeFile({ path: "docs/guide.md" }),
				makeFile({ path: "pnpm-lock.yaml" }),
			],
			"docs/**",
		);

		expect(result.files).toHaveLength(1);
		expect(result.files[0]?.path).toBe("src/app.ts");
		expect(result.excludedByPath).toEqual(["docs/guide.md", "pnpm-lock.yaml"]);
	});

	it("allows negation patterns to override defaults", () => {
		const result = filterFilesForLlm(
			[makeFile({ path: "src/app.ts" }), makeFile({ path: "public/logo.svg" })],
			"!*.svg",
		);

		expect(result.files).toHaveLength(2);
		expect(result.files.map((f) => f.path)).toEqual(["src/app.ts", "public/logo.svg"]);
		expect(result.excludedByPath).toEqual([]);
	});

	it("preserves default exclusions when custom patterns are provided", () => {
		const result = filterFilesForLlm(
			[makeFile({ path: "src/app.ts" }), makeFile({ path: "yarn.lock" })],
			"*.test.ts",
		);

		expect(result.files).toHaveLength(1);
		expect(result.files[0]?.path).toBe("src/app.ts");
		expect(result.excludedByPath).toEqual(["yarn.lock"]);
	});

	it("works normally when ignorePatterns is undefined", () => {
		const files = [makeFile({ path: "src/app.ts" }), makeFile({ path: "pnpm-lock.yaml" })];
		const result = filterFilesForLlm(files, undefined);
		expect(result.files).toHaveLength(1);
		expect(result.files[0]?.path).toBe("src/app.ts");
	});

	it("works normally when ignorePatterns is null", () => {
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
		const result = filterFilesForLlm(files, "*.generated.ts");
		expect(result.files).toHaveLength(1);
		expect(result.files[0]?.path).toBe("src/app.ts");
	});

	it("negation re-includes a previously excluded file", () => {
		const files = [
			makeFile({ path: "build/output.js" }),
			makeFile({ path: "build/important.js" }),
			makeFile({ path: "src/app.ts" }),
		];
		const result = filterFilesForLlm(files, "build/**\n!build/important.js");
		expect(result.files).toHaveLength(2);
		expect(result.files.map((f) => f.path)).toEqual(["build/important.js", "src/app.ts"]);
	});

	it("last matching pattern wins with negation", () => {
		const files = [makeFile({ path: "dist/bundle.js" })];
		const result = filterFilesForLlm(files, "dist/**\n!dist/bundle.js\n*.js");
		expect(result.files).toHaveLength(0);
	});

	it("leading slash anchors a pattern to the repo root", () => {
		const files = [makeFile({ path: "dist/bundle.js" }), makeFile({ path: "src/app.ts" })];
		const result = filterFilesForLlm(files, "/dist/**");
		expect(result.files).toHaveLength(1);
		expect(result.files[0]?.path).toBe("src/app.ts");
	});

	it("root-anchored pattern does not match nested paths", () => {
		const files = [makeFile({ path: "foo/bar.js" }), makeFile({ path: "src/foo/bar.js" })];
		const result = filterFilesForLlm(files, "/foo/**");
		expect(result.files).toHaveLength(1);
		expect(result.files[0]?.path).toBe("src/foo/bar.js");
	});

	it("trailing slash matches directory contents", () => {
		const files = [makeFile({ path: "build/output.js" }), makeFile({ path: "src/app.ts" })];
		const result = filterFilesForLlm(files, "build/");
		expect(result.files).toHaveLength(1);
		expect(result.files[0]?.path).toBe("src/app.ts");
	});

	it("negation with slashless pattern re-includes nested files", () => {
		const files = [
			makeFile({ path: "generated/schema.ts" }),
			makeFile({ path: "generated/keep-this.ts" }),
		];
		const result = filterFilesForLlm(files, "generated/**\n!keep-this.ts");
		expect(result.files).toHaveLength(1);
		expect(result.files[0]?.path).toBe("generated/keep-this.ts");
	});
});

describe("shouldIncludeFile with custom patterns", () => {
	it("excludes files matching custom patterns", () => {
		expect(shouldIncludeFile("docs/readme.md", "docs/**")).toBe(false);
	});

	it("includes files when negation overrides default", () => {
		expect(shouldIncludeFile("icon.svg")).toBe(false);
		expect(shouldIncludeFile("icon.svg", "!*.svg")).toBe(true);
	});

	it("uses defaults when ignorePatterns is null", () => {
		expect(shouldIncludeFile("pnpm-lock.yaml", null)).toBe(false);
		expect(shouldIncludeFile("src/app.ts", null)).toBe(true);
	});
});

describe("DEFAULT_IGNORE_PATTERNS", () => {
	it("contains all expected lock file patterns", () => {
		expect(DEFAULT_IGNORE_PATTERNS).toContain("package-lock.json");
		expect(DEFAULT_IGNORE_PATTERNS).toContain("yarn.lock");
		expect(DEFAULT_IGNORE_PATTERNS).toContain("pnpm-lock.yaml");
	});

	it("DEFAULT_IGNORE_PATTERNS_TEXT is the patterns joined by newlines", () => {
		expect(DEFAULT_IGNORE_PATTERNS_TEXT).toBe(DEFAULT_IGNORE_PATTERNS.join("\n"));
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

	it("returns the raw pattern text for filterFilesForLlm", () => {
		const dir = makeTempDir();
		writeFileSync(path.join(dir, ".stageignore"), "build/**\ndist/**\n");
		const patterns = loadStageIgnore(dir);
		expect(patterns).toBe("build/**\ndist/**\n");

		const result = filterFilesForLlm(
			[
				makeFile({ path: "build/config.gypi" }),
				makeFile({ path: "dist/bundle.js" }),
				makeFile({ path: "src/app.ts" }),
			],
			patterns,
		);
		expect(result.files.map((f) => f.path)).toEqual(["src/app.ts"]);
	});

	it("ignores comments and blank lines", () => {
		const dir = makeTempDir();
		writeFileSync(
			path.join(dir, ".stageignore"),
			"# Build artifacts\nbuild/**\n\n# Output\ndist/**\n\n",
		);
		const patterns = loadStageIgnore(dir);
		expect(shouldIncludeFile("build/config.gypi", patterns)).toBe(false);
		expect(shouldIncludeFile("dist/bundle.js", patterns)).toBe(false);
		expect(shouldIncludeFile("src/app.ts", patterns)).toBe(true);
	});

	it("empty .stageignore leaves only the defaults active", () => {
		const dir = makeTempDir();
		writeFileSync(path.join(dir, ".stageignore"), "");
		const patterns = loadStageIgnore(dir);
		expect(patterns).toBe("");
		expect(shouldIncludeFile("src/app.ts", patterns)).toBe(true);
		expect(shouldIncludeFile("build/anything.js", patterns)).toBe(true);
		expect(shouldIncludeFile("pnpm-lock.yaml", patterns)).toBe(false);
	});

	it("negations in .stageignore re-include default-ignored files", () => {
		const dir = makeTempDir();
		writeFileSync(path.join(dir, ".stageignore"), "!go.sum\n");
		const patterns = loadStageIgnore(dir);
		expect(shouldIncludeFile("go.sum", patterns)).toBe(true);
	});

	it(".stageignore patterns match case-insensitively", () => {
		const dir = makeTempDir();
		writeFileSync(path.join(dir, ".stageignore"), "docs/**\n");
		const patterns = loadStageIgnore(dir);
		expect(shouldIncludeFile("Docs/Guide.md", patterns)).toBe(false);
	});
});
