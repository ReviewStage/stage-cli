import { describe, expect, it } from "vitest";
import { buildChapterProgress, CHAPTER_PROGRESS_STATUS } from "../chapter-progress";

function makeChapter(order: number) {
	return {
		id: `database-${order}`,
		externalId: `chapter-${order}`,
		order,
		title: `Chapter ${order + 1}`,
	};
}

describe("chapter progress", () => {
	it("keeps visits separate from reviewed chapters and follows chapter order", () => {
		const first = makeChapter(0);
		const second = makeChapter(1);
		const third = makeChapter(2);
		const progress = buildChapterProgress([third, first, second], {
			reviewedChapterIds: new Set([second.externalId, third.id, "stale"]),
			visitedChapterIds: new Set([first.externalId, second.externalId]),
		});

		expect(progress.items.map((item) => item.status)).toEqual([
			CHAPTER_PROGRESS_STATUS.VISITED,
			CHAPTER_PROGRESS_STATUS.REVIEWED,
			CHAPTER_PROGRESS_STATUS.NOT_STARTED,
		]);
		expect(progress.reviewedCount).toBe(1);
	});

	it("counts saved review marks even when the chapter has not been visited this session", () => {
		const chapter = makeChapter(0);
		const progress = buildChapterProgress([chapter], {
			reviewedChapterIds: new Set([chapter.externalId]),
			visitedChapterIds: new Set(),
		});

		expect(progress.items[0]?.status).toBe(CHAPTER_PROGRESS_STATUS.REVIEWED);
		expect(progress.reviewedCount).toBe(1);
	});

	it("returns to visited when a review mark is removed", () => {
		const chapter = makeChapter(0);
		const progress = buildChapterProgress([chapter], {
			reviewedChapterIds: new Set(),
			visitedChapterIds: new Set([chapter.externalId]),
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
