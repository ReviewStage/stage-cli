import { describe, expect, it } from "vitest";
import { buildChapterCommentCountsMap, buildFileCommentCountsMap } from "../comment-counts";

function thread(filePath: string): { filePath: string } {
	return { filePath };
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
	const chapters = [
		{
			id: "ch-1",
			hunkRefs: [{ filePath: "a.ts" }, { filePath: "a.ts" }, { filePath: "b.ts" }],
		},
		{ id: "ch-2", hunkRefs: [{ filePath: "b.ts" }] },
		{ id: "ch-3", hunkRefs: [] },
	];

	it("initializes every chapter to zero when there are no threads", () => {
		const counts = buildChapterCommentCountsMap(chapters, []);

		expect(counts).toEqual(
			new Map([
				["ch-1", 0],
				["ch-2", 0],
				["ch-3", 0],
			]),
		);
	});

	it("counts threads on any of the chapter's files", () => {
		const counts = buildChapterCommentCountsMap(chapters, [
			thread("a.ts"),
			thread("b.ts"),
			thread("b.ts"),
		]);

		expect(counts).toEqual(
			new Map([
				["ch-1", 3],
				["ch-2", 2],
				["ch-3", 0],
			]),
		);
	});

	it("counts a thread once per chapter even when the file has several hunk refs", () => {
		const counts = buildChapterCommentCountsMap(chapters, [thread("a.ts")]);

		expect(counts.get("ch-1")).toBe(1);
	});

	it("ignores threads on files no chapter covers", () => {
		const counts = buildChapterCommentCountsMap(chapters, [thread("elsewhere.ts")]);

		expect(counts).toEqual(
			new Map([
				["ch-1", 0],
				["ch-2", 0],
				["ch-3", 0],
			]),
		);
	});
});
