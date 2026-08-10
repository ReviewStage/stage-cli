import type { HunkReference } from "@stagereview/types/chapters";
import { describe, expect, it } from "vitest";
import {
	type DiffLineRecord,
	FILE_STATUS,
	type HunkRecord,
	type PullRequestFile,
} from "../diff-types";
import {
	buildHunkIndex,
	type ChapterHunkReferences,
	collectViewedChapterHunkRefs,
	computeFileLineCounts,
	computeRemainingPullRequestLineCounts,
} from "../remaining-line-counts";

function createHunk(oldStart: number, lines: { additions: number; deletions: number }): HunkRecord {
	const additionLines: DiffLineRecord[] = Array.from({ length: lines.additions }, () => ({
		type: "addition",
		content: "+added",
		newLineNumber: 1,
	}));
	const deletionLines: DiffLineRecord[] = Array.from({ length: lines.deletions }, () => ({
		type: "deletion",
		content: "-deleted",
		oldLineNumber: 1,
	}));
	const hunkLines = [...additionLines, ...deletionLines];

	return {
		header: `@@ -${oldStart},5 +${oldStart},5 @@`,
		oldStart,
		newStart: oldStart,
		oldLines: 5,
		newLines: 5,
		lines: hunkLines,
	};
}

function createFile(
	path: string,
	additions: number,
	deletions: number,
	hunks: HunkRecord[] = [],
): PullRequestFile {
	return {
		path,
		filename: path,
		status: FILE_STATUS.MODIFIED,
		additions,
		deletions,
		hunks,
	};
}

function ref(filePath: string, oldStart: number): HunkReference {
	return { filePath, oldStart };
}

const NO_VIEWED_FILES: ReadonlySet<string> = new Set();

describe("computeFileLineCounts", () => {
	it("sums full file additions and deletions", () => {
		const files = [createFile("a.ts", 8, 2), createFile("b.ts", 3, 5)];

		expect(computeFileLineCounts(files)).toEqual({ linesAdded: 11, linesDeleted: 7 });
	});
});

describe("computeRemainingPullRequestLineCounts", () => {
	it("subtracts whole files that are marked viewed", () => {
		const files = [createFile("already-reviewed.ts", 8, 2), createFile("left-to-review.ts", 3, 5)];
		const viewedPaths = new Set(["already-reviewed.ts"]);

		const result = computeRemainingPullRequestLineCounts(
			files,
			(path) => viewedPaths.has(path),
			[],
			buildHunkIndex(files),
		);

		expect(result).toEqual({ linesAdded: 3, linesDeleted: 5 });
	});

	it("subtracts viewed chapter hunks from run-wide remaining lines", () => {
		const files = [
			createFile("shared.ts", 8, 3, [
				createHunk(1, { additions: 5, deletions: 1 }),
				createHunk(20, { additions: 3, deletions: 2 }),
			]),
			createFile("unrelated.ts", 2, 1, [createHunk(1, { additions: 2, deletions: 1 })]),
		];

		const result = computeRemainingPullRequestLineCounts(
			files,
			() => false,
			[ref("shared.ts", 1)],
			buildHunkIndex(files),
		);

		expect(result).toEqual({ linesAdded: 5, linesDeleted: 3 });
	});

	it("does not double-subtract the same viewed hunk", () => {
		const files = [
			createFile("shared.ts", 8, 3, [
				createHunk(1, { additions: 5, deletions: 1 }),
				createHunk(20, { additions: 3, deletions: 2 }),
			]),
		];

		const result = computeRemainingPullRequestLineCounts(
			files,
			() => false,
			[ref("shared.ts", 1), ref("shared.ts", 1)],
			buildHunkIndex(files),
		);

		expect(result).toEqual({ linesAdded: 3, linesDeleted: 2 });
	});

	it("subtracts a fully viewed file only once when chapter hunks are also viewed", () => {
		const files = [
			createFile("viewed.ts", 5, 1, [createHunk(1, { additions: 5, deletions: 1 })]),
			createFile("left.ts", 2, 2, [createHunk(1, { additions: 2, deletions: 2 })]),
		];

		const result = computeRemainingPullRequestLineCounts(
			files,
			(path) => path === "viewed.ts",
			[ref("viewed.ts", 1)],
			buildHunkIndex(files),
		);

		expect(result).toEqual({ linesAdded: 2, linesDeleted: 2 });
	});
});

describe("collectViewedChapterHunkRefs", () => {
	const chapters: ChapterHunkReferences[] = [
		{ externalId: "a", hunkRefs: [ref("shared.ts", 1), ref("a-only.ts", 1)] },
		{ externalId: "b", hunkRefs: [ref("shared.ts", 50), ref("b-only.ts", 1)] },
	];

	it("collects every ref from a fully viewed chapter", () => {
		const result = collectViewedChapterHunkRefs(chapters, new Set(["a"]), NO_VIEWED_FILES);

		expect(result).toEqual([ref("shared.ts", 1), ref("a-only.ts", 1)]);
	});

	it("collects only viewed-file refs from a partially viewed chapter", () => {
		const result = collectViewedChapterHunkRefs(chapters, new Set(), new Set(["b-only.ts"]));

		expect(result).toEqual([ref("b-only.ts", 1)]);
	});

	it("only collects the viewed chapter's hunks for a file spread across chapters", () => {
		// shared.ts appears in both chapters; only chapter a is viewed, so only its
		// hunk of shared.ts should count as reviewed.
		const result = collectViewedChapterHunkRefs(chapters, new Set(["a"]), NO_VIEWED_FILES);

		expect(result).toEqual([ref("shared.ts", 1), ref("a-only.ts", 1)]);
	});
});

describe("remaining lines for files spread across chapters", () => {
	it("keeps a multi-chapter file's unviewed hunks remaining when one chapter is viewed", () => {
		const files = [
			createFile("shared.ts", 8, 4, [
				createHunk(1, { additions: 5, deletions: 1 }),
				createHunk(50, { additions: 3, deletions: 3 }),
			]),
		];
		const chapters: ChapterHunkReferences[] = [
			{ externalId: "a", hunkRefs: [ref("shared.ts", 1)] },
			{ externalId: "b", hunkRefs: [ref("shared.ts", 50)] },
		];

		const viewedHunkRefs = collectViewedChapterHunkRefs(chapters, new Set(["a"]), NO_VIEWED_FILES);
		const result = computeRemainingPullRequestLineCounts(
			files,
			() => false,
			viewedHunkRefs,
			buildHunkIndex(files),
		);

		expect(result).toEqual({ linesAdded: 3, linesDeleted: 3 });
	});

	it("leaves hunks that no chapter covers remaining even when all of a file's chapters are viewed", () => {
		// hunk 99 is orphaned: it belongs to no chapter, so viewing every chapter
		// that references shared.ts must not subtract it.
		const files = [
			createFile("shared.ts", 10, 2, [
				createHunk(1, { additions: 4, deletions: 1 }),
				createHunk(50, { additions: 4, deletions: 1 }),
				createHunk(99, { additions: 2, deletions: 0 }),
			]),
		];
		const chapters: ChapterHunkReferences[] = [
			{ externalId: "a", hunkRefs: [ref("shared.ts", 1)] },
			{ externalId: "b", hunkRefs: [ref("shared.ts", 50)] },
		];

		const viewedHunkRefs = collectViewedChapterHunkRefs(
			chapters,
			new Set(["a", "b"]),
			NO_VIEWED_FILES,
		);
		const result = computeRemainingPullRequestLineCounts(
			files,
			() => false,
			viewedHunkRefs,
			buildHunkIndex(files),
		);

		expect(result).toEqual({ linesAdded: 2, linesDeleted: 0 });
	});

	it("subtracts the whole file only when it is genuinely whole-file viewed", () => {
		const files = [
			createFile("shared.ts", 10, 2, [
				createHunk(1, { additions: 4, deletions: 1 }),
				createHunk(50, { additions: 4, deletions: 1 }),
				createHunk(99, { additions: 2, deletions: 0 }),
			]),
		];

		const result = computeRemainingPullRequestLineCounts(
			files,
			(path) => path === "shared.ts",
			[],
			buildHunkIndex(files),
		);

		expect(result).toEqual({ linesAdded: 0, linesDeleted: 0 });
	});
});
