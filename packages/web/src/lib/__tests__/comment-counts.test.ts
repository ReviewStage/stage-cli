import { DIFF_SIDE, type DiffSide } from "@stagereview/types/chapters";
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
});
