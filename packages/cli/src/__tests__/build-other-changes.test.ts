import type { PullRequestFile } from "@stagereview/types/parsed-diff";
import { describe, expect, it } from "vitest";
import { buildOtherChangesChapter } from "../build-other-changes.js";

function createFile(overrides?: Partial<PullRequestFile>): PullRequestFile {
	return {
		path: "src/app.ts",
		filename: "app.ts",
		status: "modified",
		additions: 1,
		deletions: 0,
		hunks: [
			{
				header: "@@ -1,1 +1,2 @@",
				oldStart: 1,
				newStart: 1,
				oldLines: 1,
				newLines: 2,
				lines: [{ type: "addition", content: "x", newLineNumber: 2 }],
			},
		],
		patch: "",
		...overrides,
	};
}

describe("buildOtherChangesChapter", () => {
	it("returns null when nothing was excluded", () => {
		const result = buildOtherChangesChapter([createFile()], []);
		expect(result).toBeNull();
	});

	it("builds hunkRefs for an excluded file with hunks", () => {
		const lockfile = createFile({
			path: "pnpm-lock.yaml",
			hunks: [
				{
					header: "@@ -1,1 +1,2 @@",
					oldStart: 1,
					newStart: 1,
					oldLines: 1,
					newLines: 2,
					lines: [],
				},
				{
					header: "@@ -10,1 +11,2 @@",
					oldStart: 10,
					newStart: 11,
					oldLines: 1,
					newLines: 2,
					lines: [],
				},
			],
		});

		const result = buildOtherChangesChapter([lockfile], ["pnpm-lock.yaml"]);

		expect(result).not.toBeNull();
		expect(result?.id).toBe("chapter-other-changes");
		expect(result?.title).toBe("Other changes");
		expect(result?.keyChanges).toEqual([]);
		expect(result?.hunkRefs).toEqual([
			{ filePath: "pnpm-lock.yaml", oldStart: 1 },
			{ filePath: "pnpm-lock.yaml", oldStart: 10 },
		]);
	});

	it("emits no hunkRefs for binary-only excluded files", () => {
		const binary = createFile({ path: "public/logo.png", hunks: [] });

		const result = buildOtherChangesChapter([binary], ["public/logo.png"]);

		expect(result?.hunkRefs).toEqual([]);
	});

	it("ignores files not in excludedByPath", () => {
		const code = createFile({ path: "src/app.ts" });
		const lockfile = createFile({ path: "pnpm-lock.yaml" });

		const result = buildOtherChangesChapter([code, lockfile], ["pnpm-lock.yaml"]);

		expect(result?.hunkRefs.every((ref) => ref.filePath === "pnpm-lock.yaml")).toBe(true);
	});

	it("preserves PR file order in hunkRefs, not excludedByPath order", () => {
		const lockfile = createFile({ path: "pnpm-lock.yaml" });
		const image = createFile({ path: "public/logo.png" });

		const result = buildOtherChangesChapter(
			[lockfile, image],
			["public/logo.png", "pnpm-lock.yaml"],
		);

		expect(result?.hunkRefs.map((ref) => ref.filePath)).toEqual([
			"pnpm-lock.yaml",
			"public/logo.png",
		]);
	});
});
