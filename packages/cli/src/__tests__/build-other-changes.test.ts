import { HEADER_ONLY_OLD_START } from "@stagereview/types/chapters";
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
	it("returns null when no files are excluded and all files have hunks", () => {
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

	it("emits sentinel hunkRef for excluded files without hunks", () => {
		const binary = createFile({ path: "public/logo.png", hunks: [] });

		const result = buildOtherChangesChapter([binary], ["public/logo.png"]);

		expect(result?.hunkRefs).toEqual([
			{ filePath: "public/logo.png", oldStart: HEADER_ONLY_OLD_START },
		]);
	});

	it("emits sentinel hunkRef for non-excluded files without hunks", () => {
		const moved = createFile({ path: "src/moved.ts", status: "moved", hunks: [] });

		const result = buildOtherChangesChapter([moved], []);

		expect(result).not.toBeNull();
		expect(result?.hunkRefs).toEqual([
			{ filePath: "src/moved.ts", oldStart: HEADER_ONLY_OLD_START },
		]);
	});

	it("skips non-excluded files with hunks (handled by LLM)", () => {
		const code = createFile({ path: "src/app.ts" });
		const lockfile = createFile({ path: "pnpm-lock.yaml" });

		const result = buildOtherChangesChapter([code, lockfile], ["pnpm-lock.yaml"]);

		expect(result?.hunkRefs.every((ref) => ref.filePath === "pnpm-lock.yaml")).toBe(true);
	});

	it("preserves PR file order in hunkRefs, not excludedByPath order", () => {
		const lockfile = createFile({ path: "pnpm-lock.yaml" });
		const image = createFile({ path: "public/logo.png" });

		// excludedByPath has image first, but allFiles has lockfile first.
		const result = buildOtherChangesChapter(
			[lockfile, image],
			["public/logo.png", "pnpm-lock.yaml"],
		);

		expect(result?.hunkRefs.map((ref) => ref.filePath)).toEqual([
			"pnpm-lock.yaml",
			"public/logo.png",
		]);
	});

	it("includes both excluded and hunkless non-excluded files", () => {
		const code = createFile({ path: "src/app.ts" });
		const lockfile = createFile({ path: "pnpm-lock.yaml" });
		const moved = createFile({ path: "src/moved.ts", status: "moved", hunks: [] });

		const result = buildOtherChangesChapter([code, lockfile, moved], ["pnpm-lock.yaml"]);

		expect(result?.hunkRefs.map((ref) => ref.filePath)).toEqual(["pnpm-lock.yaml", "src/moved.ts"]);
	});

	it("carries null riskLevel and empty riskReasons", () => {
		const result = buildOtherChangesChapter([createFile({ path: "yarn.lock" })], ["yarn.lock"]);
		expect(result?.riskLevel).toBeNull();
		expect(result?.riskReasons).toEqual([]);
	});
});
