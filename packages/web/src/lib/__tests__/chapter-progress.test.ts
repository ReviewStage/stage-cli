import { describe, expect, it } from "vitest";
import { buildChapterProgress, CHAPTER_PROGRESS_STATUS } from "../chapter-progress";

function makeChapter(order: number) {
	return { id: String(order), externalId: String(order), order, title: `Chapter ${order + 1}` };
}

describe("chapter progress", () => {
	it("keeps visits separate from reviewed chapters and follows chapter order", () => {
		const progress = buildChapterProgress([makeChapter(2), makeChapter(0), makeChapter(1)], {
			reviewedChapterIds: new Set(["1", "stale"]),
			visitedChapterIds: new Set(["0", "1"]),
		});

		expect(progress.items.map((item) => item.status)).toEqual([
			CHAPTER_PROGRESS_STATUS.VISITED,
			CHAPTER_PROGRESS_STATUS.REVIEWED,
			CHAPTER_PROGRESS_STATUS.NOT_STARTED,
		]);
		expect(progress.reviewedCount).toBe(1);
	});

	it("counts saved review marks even when the chapter has not been visited this session", () => {
		const progress = buildChapterProgress([makeChapter(0)], {
			reviewedChapterIds: new Set(["0"]),
			visitedChapterIds: new Set(),
		});

		expect(progress.items[0]?.status).toBe(CHAPTER_PROGRESS_STATUS.REVIEWED);
		expect(progress.reviewedCount).toBe(1);
	});

	it("returns to visited when a review mark is removed", () => {
		const progress = buildChapterProgress([makeChapter(0)], {
			reviewedChapterIds: new Set(),
			visitedChapterIds: new Set(["0"]),
		});

		expect(progress.items[0]?.status).toBe(CHAPTER_PROGRESS_STATUS.VISITED);
		expect(progress.reviewedCount).toBe(0);
	});

	it("has no progress when there are no chapters", () => {
		expect(
			buildChapterProgress([], { reviewedChapterIds: new Set(), visitedChapterIds: new Set() }),
		).toEqual({ items: [], reviewedCount: 0 });
	});
});
