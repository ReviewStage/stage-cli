import { DIFF_SIDE, type DiffSide } from "@stagereview/types/chapters";
import { SUBJECT_TYPE } from "@stagereview/types/review";
import { describe, expect, it } from "vitest";
import {
	buildChapterCommentCountsMap,
	buildFileCommentCountsMap,
	buildHunkRangeIndex,
	type CommentThreadLike,
	type HunkRangeSource,
} from "../comment-counts";

function thread(
	filePath: string,
	endLine = 1,
	side: DiffSide = DIFF_SIDE.ADDITIONS,
): CommentThreadLike {
	return { filePath, side, endLine };
}

function fileThread(filePath: string): CommentThreadLike {
	return { filePath, side: DIFF_SIDE.ADDITIONS, endLine: null, subjectType: SUBJECT_TYPE.FILE };
}

/** An outdated line thread: GitHub nulled its live anchor, leaving the original one. */
function outdatedThread(filePath: string, originalLine: number): CommentThreadLike {
	return {
		filePath,
		side: DIFF_SIDE.ADDITIONS,
		endLine: null,
		subjectType: SUBJECT_TYPE.LINE,
		originalLine,
	};
}

interface HunkSpec {
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
}

function makeFile(name: string, hunks: HunkSpec[]): HunkRangeSource {
	return {
		name,
		hunks: hunks.map((h) => ({
			deletionStart: h.oldStart,
			deletionCount: h.oldLines,
			additionStart: h.newStart,
			additionCount: h.newLines,
		})),
	};
}

describe("buildFileCommentCountsMap", () => {
	it("initializes every file to zero", () => {
		const counts = buildFileCommentCountsMap([{ path: "a.ts" }, { path: "b.ts" }], []);

		expect(counts).toEqual(
			new Map([
				["a.ts", 0],
				["b.ts", 0],
			]),
		);
	});

	it("counts one per thread anchored to the file", () => {
		const counts = buildFileCommentCountsMap(
			[{ path: "a.ts" }, { path: "b.ts" }],
			[thread("a.ts"), thread("a.ts"), thread("b.ts")],
		);

		expect(counts).toEqual(
			new Map([
				["a.ts", 2],
				["b.ts", 1],
			]),
		);
	});

	it("ignores threads on files outside the given set", () => {
		const counts = buildFileCommentCountsMap([{ path: "a.ts" }], [thread("elsewhere.ts")]);

		expect(counts).toEqual(new Map([["a.ts", 0]]));
	});

	it("counts a whole-file thread toward its file", () => {
		const counts = buildFileCommentCountsMap(
			[{ path: "a.ts" }, { path: "b.ts" }],
			[fileThread("a.ts"), thread("a.ts", 3)],
		);

		expect(counts).toEqual(
			new Map([
				["a.ts", 2],
				["b.ts", 0],
			]),
		);
	});

	it("ignores a whole-file thread on a path outside the given set", () => {
		const counts = buildFileCommentCountsMap([{ path: "a.ts" }], [fileThread("elsewhere.ts")]);

		expect(counts).toEqual(new Map([["a.ts", 0]]));
	});
});

describe("buildChapterCommentCountsMap", () => {
	it("initializes every chapter to zero when there are no threads", () => {
		const index = buildHunkRangeIndex([
			makeFile("a.ts", [{ oldStart: 1, oldLines: 10, newStart: 1, newLines: 12 }]),
		]);
		const chapters = [
			{ id: "ch-1", hunkRefs: [{ filePath: "a.ts", oldStart: 1 }] },
			{ id: "ch-2", hunkRefs: [] },
		];

		const counts = buildChapterCommentCountsMap(chapters, index, []);

		expect(counts).toEqual(
			new Map([
				["ch-1", 0],
				["ch-2", 0],
			]),
		);
	});

	it("does not count a file-level thread for a chapter ref that resolves nothing", () => {
		// A hunked file referenced only by a stale/invalid oldStart renders
		// nothing in the chapter, so its whole-file threads don't count either.
		const index = buildHunkRangeIndex([
			makeFile("src/app.ts", [{ oldStart: 1, oldLines: 10, newStart: 1, newLines: 12 }]),
		]);
		const chapter = { id: "ch-1", hunkRefs: [{ filePath: "src/app.ts", oldStart: 99 }] };

		const counts = buildChapterCommentCountsMap([chapter], index, [fileThread("src/app.ts")]);

		expect(counts.get("ch-1")).toBe(0);
	});

	it("counts a file-level thread toward a chapter whose only ref for the path is header-only", () => {
		// Binary changes and pure renames carry the header-only sentinel
		// (oldStart 0) with no parsed hunk in the index; a whole-file thread
		// matches by path alone, keeping file and chapter badges consistent.
		const index = buildHunkRangeIndex([makeFile("assets/logo.png", [])]);
		const chapter = {
			id: "other-changes",
			hunkRefs: [{ filePath: "assets/logo.png", oldStart: 0 }],
		};

		const counts = buildChapterCommentCountsMap([chapter], index, [fileThread("assets/logo.png")]);

		expect(counts.get("other-changes")).toBe(1);
	});

	it("matches an additions-side thread by the hunk's new-file line range", () => {
		const index = buildHunkRangeIndex([
			makeFile("src/app.ts", [{ oldStart: 1, oldLines: 10, newStart: 1, newLines: 12 }]),
		]);
		const chapter = { id: "ch-1", hunkRefs: [{ filePath: "src/app.ts", oldStart: 1 }] };

		const counts = buildChapterCommentCountsMap([chapter], index, [
			thread("src/app.ts", 5, DIFF_SIDE.ADDITIONS),
		]);

		expect(counts.get("ch-1")).toBe(1);
	});

	it("does not count an additions-side thread outside the hunk range", () => {
		const index = buildHunkRangeIndex([
			makeFile("src/app.ts", [{ oldStart: 1, oldLines: 10, newStart: 1, newLines: 12 }]),
		]);
		const chapter = { id: "ch-1", hunkRefs: [{ filePath: "src/app.ts", oldStart: 1 }] };

		const counts = buildChapterCommentCountsMap([chapter], index, [
			thread("src/app.ts", 20, DIFF_SIDE.ADDITIONS),
		]);

		expect(counts.get("ch-1")).toBe(0);
	});

	it("matches a deletions-side thread by the hunk's old-file line range", () => {
		const index = buildHunkRangeIndex([
			makeFile("src/utils.ts", [{ oldStart: 10, oldLines: 5, newStart: 10, newLines: 8 }]),
		]);
		const chapter = { id: "ch-1", hunkRefs: [{ filePath: "src/utils.ts", oldStart: 10 }] };

		const counts = buildChapterCommentCountsMap([chapter], index, [
			thread("src/utils.ts", 12, DIFF_SIDE.DELETIONS),
		]);

		expect(counts.get("ch-1")).toBe(1);
	});

	it("matches an outdated thread by its original line against the old-file range", () => {
		// Hosted's original_line fallback in commentMatchesHunk: an outdated
		// comment (line=null) matches when its frozen anchor falls in the
		// hunk's old-file range, regardless of side.
		const index = buildHunkRangeIndex([
			makeFile("src/app.ts", [{ oldStart: 10, oldLines: 5, newStart: 20, newLines: 8 }]),
		]);
		const chapter = { id: "ch-1", hunkRefs: [{ filePath: "src/app.ts", oldStart: 10 }] };

		const counts = buildChapterCommentCountsMap([chapter], index, [
			outdatedThread("src/app.ts", 12),
		]);

		expect(counts.get("ch-1")).toBe(1);
	});

	it("does not count an outdated thread whose original line misses the old-file range", () => {
		const index = buildHunkRangeIndex([
			makeFile("src/app.ts", [{ oldStart: 10, oldLines: 5, newStart: 20, newLines: 8 }]),
		]);
		const chapter = { id: "ch-1", hunkRefs: [{ filePath: "src/app.ts", oldStart: 10 }] };

		const counts = buildChapterCommentCountsMap([chapter], index, [
			outdatedThread("src/app.ts", 22),
		]);

		expect(counts.get("ch-1")).toBe(0);
	});

	it("returns zero for a thread on a file no chapter references", () => {
		const index = buildHunkRangeIndex([
			makeFile("src/app.ts", [{ oldStart: 1, oldLines: 10, newStart: 1, newLines: 12 }]),
		]);
		const chapter = { id: "ch-1", hunkRefs: [{ filePath: "src/app.ts", oldStart: 1 }] };

		const counts = buildChapterCommentCountsMap([chapter], index, [thread("src/other.ts", 5)]);

		expect(counts.get("ch-1")).toBe(0);
	});

	it("assigns threads to the chapter owning the matching hunk when chapters share a file", () => {
		const index = buildHunkRangeIndex([
			makeFile("src/shared.ts", [
				{ oldStart: 1, oldLines: 10, newStart: 1, newLines: 10 },
				{ oldStart: 50, oldLines: 5, newStart: 55, newLines: 8 },
			]),
		]);
		const ch1 = { id: "ch-1", hunkRefs: [{ filePath: "src/shared.ts", oldStart: 1 }] };
		const ch2 = { id: "ch-2", hunkRefs: [{ filePath: "src/shared.ts", oldStart: 50 }] };

		const counts = buildChapterCommentCountsMap([ch1, ch2], index, [
			thread("src/shared.ts", 5),
			thread("src/shared.ts", 57),
			thread("src/shared.ts", 57),
		]);

		expect(counts.get("ch-1")).toBe(1);
		expect(counts.get("ch-2")).toBe(2);
	});

	it("counts a thread once per chapter even when the file has duplicate hunk refs", () => {
		const index = buildHunkRangeIndex([
			makeFile("a.ts", [{ oldStart: 1, oldLines: 10, newStart: 1, newLines: 10 }]),
		]);
		const chapter = {
			id: "ch-1",
			hunkRefs: [
				{ filePath: "a.ts", oldStart: 1 },
				{ filePath: "a.ts", oldStart: 1 },
			],
		};

		const counts = buildChapterCommentCountsMap([chapter], index, [thread("a.ts", 3)]);

		expect(counts.get("ch-1")).toBe(1);
	});

	it("ignores hunk refs that don't resolve against the index", () => {
		const index = buildHunkRangeIndex([
			makeFile("a.ts", [{ oldStart: 1, oldLines: 10, newStart: 1, newLines: 10 }]),
		]);
		const chapter = { id: "ch-1", hunkRefs: [{ filePath: "a.ts", oldStart: 99 }] };

		const counts = buildChapterCommentCountsMap([chapter], index, [thread("a.ts", 3)]);

		expect(counts.get("ch-1")).toBe(0);
	});

	it("counts a whole-file thread toward every chapter containing hunks of its file", () => {
		const index = buildHunkRangeIndex([
			makeFile("src/shared.ts", [
				{ oldStart: 1, oldLines: 10, newStart: 1, newLines: 10 },
				{ oldStart: 50, oldLines: 5, newStart: 55, newLines: 8 },
			]),
			makeFile("src/other.ts", [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3 }]),
		]);
		const ch1 = { id: "ch-1", hunkRefs: [{ filePath: "src/shared.ts", oldStart: 1 }] };
		const ch2 = { id: "ch-2", hunkRefs: [{ filePath: "src/shared.ts", oldStart: 50 }] };
		const ch3 = { id: "ch-3", hunkRefs: [{ filePath: "src/other.ts", oldStart: 1 }] };

		const counts = buildChapterCommentCountsMap([ch1, ch2, ch3], index, [
			fileThread("src/shared.ts"),
		]);

		expect(counts.get("ch-1")).toBe(1);
		expect(counts.get("ch-2")).toBe(1);
		expect(counts.get("ch-3")).toBe(0);
	});

	it("counts a whole-file thread once per chapter", () => {
		const index = buildHunkRangeIndex([
			makeFile("a.ts", [
				{ oldStart: 1, oldLines: 5, newStart: 1, newLines: 5 },
				{ oldStart: 20, oldLines: 5, newStart: 20, newLines: 5 },
			]),
		]);
		const chapter = {
			id: "ch-1",
			hunkRefs: [
				{ filePath: "a.ts", oldStart: 1 },
				{ filePath: "a.ts", oldStart: 20 },
			],
		};

		const counts = buildChapterCommentCountsMap([chapter], index, [fileThread("a.ts")]);

		expect(counts.get("ch-1")).toBe(1);
	});

	it("ignores a whole-file thread on a path not in the diff", () => {
		const index = buildHunkRangeIndex([
			makeFile("a.ts", [{ oldStart: 1, oldLines: 10, newStart: 1, newLines: 10 }]),
		]);
		const chapter = { id: "ch-1", hunkRefs: [{ filePath: "a.ts", oldStart: 1 }] };

		const counts = buildChapterCommentCountsMap([chapter], index, [fileThread("elsewhere.ts")]);

		expect(counts.get("ch-1")).toBe(0);
	});
});
