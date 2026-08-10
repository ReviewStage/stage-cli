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
		const headerOnlyPaths = new Set(["assets/logo.png", "docs/renamed.md"]);

		const repaired = repairLegacyHeaderOnlyRefs(headerOnlyPaths, chapters);

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

		const repaired = repairLegacyHeaderOnlyRefs(new Set(["assets/logo.png"]), chapters);

		expect(repaired).toHaveLength(2);
		expect(repaired[1]).toMatchObject({
			id: OTHER_CHANGES_CHAPTER_ID,
			order: 4,
			hunkRefs: [{ filePath: "assets/logo.png", oldStart: HEADER_ONLY_OLD_START }],
		});
	});

	it("leaves chapters untouched when no files are header-only", () => {
		const chapters = [
			makeChapter({
				id: "chapter-1",
				order: 1,
				hunkRefs: [{ filePath: "src/foo.ts", oldStart: 1 }],
			}),
		];

		expect(repairLegacyHeaderOnlyRefs(new Set(), chapters)).toBe(chapters);
	});

	it("leaves chapters untouched when sentinels are already covered", () => {
		const chapters = [
			makeChapter({
				id: OTHER_CHANGES_CHAPTER_ID,
				order: 1,
				hunkRefs: [{ filePath: "assets/logo.png", oldStart: HEADER_ONLY_OLD_START }],
			}),
		];

		expect(repairLegacyHeaderOnlyRefs(new Set(["assets/logo.png"]), chapters)).toBe(chapters);
	});

	it("does not absorb an added file's missing real oldStart-0 hunk", () => {
		// An added file's only hunk is `@@ -0,0 +1,N @@` — oldStart 0, the same
		// value as the header-only sentinel. The file HAS hunks, so it is not
		// header-only, and its missing ref must be left for coverage validation
		// to reject rather than appended to Other Changes.
		const chapters = [
			makeChapter({
				id: "chapter-1",
				order: 1,
				hunkRefs: [{ filePath: "src/foo.ts", oldStart: 1 }],
			}),
		];

		expect(repairLegacyHeaderOnlyRefs(new Set(), chapters)).toBe(chapters);
	});
});
