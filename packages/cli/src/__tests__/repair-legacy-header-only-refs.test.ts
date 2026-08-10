import { describe, expect, it } from "vitest";
import { OTHER_CHANGES_CHAPTER_ID } from "../build-other-changes.js";
import { type Chapter, HEADER_ONLY_OLD_START } from "../schema.js";
import { repairLegacyHeaderOnlyRefs } from "../show.js";

function makeChapter(overrides: Partial<Chapter> & Pick<Chapter, "id" | "order">): Chapter {
	return {
		title: `Chapter ${overrides.id}`,
		summary: `Summary for ${overrides.id}`,
		hunkRefs: [],
		keyChanges: [],
		riskLevel: null,
		riskReasons: [],
		...overrides,
	};
}

function expectedMap(entries: [string, number[]][]): Map<string, Set<number>> {
	return new Map(entries.map(([filePath, starts]) => [filePath, new Set(starts)]));
}

describe("repairLegacyHeaderOnlyRefs", () => {
	it("appends missing header-only sentinels to the existing other-changes chapter", () => {
		const chapters = [
			makeChapter({
				id: "chapter-1",
				order: 1,
				hunkRefs: [{ filePath: "src/foo.ts", oldStart: 1 }],
			}),
			makeChapter({
				id: OTHER_CHANGES_CHAPTER_ID,
				order: 2,
				hunkRefs: [{ filePath: "pnpm-lock.yaml", oldStart: 3 }],
			}),
		];
		const expected = expectedMap([
			["src/foo.ts", [1]],
			["pnpm-lock.yaml", [3]],
			["assets/logo.png", [HEADER_ONLY_OLD_START]],
			["docs/renamed.md", [HEADER_ONLY_OLD_START]],
		]);

		const repaired = repairLegacyHeaderOnlyRefs(expected, chapters);

		expect(repaired[0]).toBe(chapters[0]);
		expect(repaired[1]?.hunkRefs).toEqual([
			{ filePath: "pnpm-lock.yaml", oldStart: 3 },
			{ filePath: "assets/logo.png", oldStart: HEADER_ONLY_OLD_START },
			{ filePath: "docs/renamed.md", oldStart: HEADER_ONLY_OLD_START },
		]);
	});

	it("creates an other-changes chapter when the legacy file has none", () => {
		const chapters = [
			makeChapter({
				id: "chapter-1",
				order: 3,
				hunkRefs: [{ filePath: "src/foo.ts", oldStart: 1 }],
			}),
		];
		const expected = expectedMap([
			["src/foo.ts", [1]],
			["assets/logo.png", [HEADER_ONLY_OLD_START]],
		]);

		const repaired = repairLegacyHeaderOnlyRefs(expected, chapters);

		expect(repaired).toHaveLength(2);
		expect(repaired[1]).toMatchObject({
			id: OTHER_CHANGES_CHAPTER_ID,
			order: 4,
			hunkRefs: [{ filePath: "assets/logo.png", oldStart: HEADER_ONLY_OLD_START }],
		});
	});

	it("leaves chapters untouched when only real hunk refs are missing", () => {
		const chapters = [
			makeChapter({
				id: "chapter-1",
				order: 1,
				hunkRefs: [{ filePath: "src/foo.ts", oldStart: 1 }],
			}),
		];
		const expected = expectedMap([["src/foo.ts", [1, 42]]]);

		expect(repairLegacyHeaderOnlyRefs(expected, chapters)).toBe(chapters);
	});

	it("leaves chapters untouched when sentinels are already covered", () => {
		const chapters = [
			makeChapter({
				id: OTHER_CHANGES_CHAPTER_ID,
				order: 1,
				hunkRefs: [{ filePath: "assets/logo.png", oldStart: HEADER_ONLY_OLD_START }],
			}),
		];
		const expected = expectedMap([["assets/logo.png", [HEADER_ONLY_OLD_START]]]);

		expect(repairLegacyHeaderOnlyRefs(expected, chapters)).toBe(chapters);
	});
});
