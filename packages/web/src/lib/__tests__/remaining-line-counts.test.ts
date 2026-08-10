import { getSingularPatch } from "@pierre/diffs";
import type { HunkReference } from "@stagereview/types/chapters";
import { describe, expect, it } from "vitest";
import { type FileDiffEntry, fileDiffToPullRequestFile } from "../parse-diff";
import {
	buildHunkIndex,
	type ChapterHunkReferences,
	collectViewedChapterHunkRefs,
	computeFileLineCounts,
	computeRemainingPullRequestLineCounts,
} from "../remaining-line-counts";

interface HunkSpec {
	oldStart: number;
	additions: number;
	deletions: number;
}

/**
 * Builds a FileDiffEntry from a synthetic unified diff the same way the app
 * does (`useFileDiffEntries` → Pierre parse → `fileDiffToPullRequestFile`).
 * This reproduces the CLI's real input shape: hunks live on `entry.diff` and
 * `entry.file.hunks` is always empty.
 */
function createEntry(path: string, hunks: HunkSpec[]): FileDiffEntry {
	const body = hunks
		.map((h) =>
			[
				`@@ -${h.oldStart},${h.deletions + 1} +${h.oldStart},${h.additions + 1} @@`,
				" context",
				...Array.from({ length: h.deletions }, (_, i) => `-old ${i}`),
				...Array.from({ length: h.additions }, (_, i) => `+new ${i}`),
			].join("\n"),
		)
		.join("\n");
	const patch = [
		`diff --git a/${path} b/${path}`,
		"index 1111111..2222222 100644",
		`--- a/${path}`,
		`+++ b/${path}`,
		`${body}`,
		"",
	].join("\n");
	const diff = getSingularPatch(patch);
	return { file: fileDiffToPullRequestFile(diff), diff };
}

function filesOf(entries: FileDiffEntry[]) {
	return entries.map((entry) => entry.file);
}

function ref(filePath: string, oldStart: number): HunkReference {
	return { filePath, oldStart };
}

const NO_VIEWED_FILES: ReadonlySet<string> = new Set();

describe("computeFileLineCounts", () => {
	it("sums full file additions and deletions", () => {
		const entries = [
			createEntry("a.ts", [{ oldStart: 1, additions: 8, deletions: 2 }]),
			createEntry("b.ts", [{ oldStart: 1, additions: 3, deletions: 5 }]),
		];

		expect(computeFileLineCounts(filesOf(entries))).toEqual({ linesAdded: 11, linesDeleted: 7 });
	});
});

describe("buildHunkIndex", () => {
	it("indexes the parsed Pierre hunks even though PullRequestFile carries none", () => {
		// Regression: the CLI's fileDiffToPullRequestFile always emits hunks: [],
		// so an index built from file.hunks would be empty and viewed chapters
		// would never reduce the remaining counts.
		const entries = [
			createEntry("shared.ts", [
				{ oldStart: 1, additions: 5, deletions: 1 },
				{ oldStart: 20, additions: 3, deletions: 2 },
			]),
		];
		expect(entries[0]?.file.hunks).toEqual([]);

		const index = buildHunkIndex(entries);

		expect(index.get("shared.ts")?.get(1)).toEqual({ linesAdded: 5, linesDeleted: 1 });
		expect(index.get("shared.ts")?.get(20)).toEqual({ linesAdded: 3, linesDeleted: 2 });
	});
});

describe("computeRemainingPullRequestLineCounts", () => {
	it("subtracts whole files that are marked viewed", () => {
		const entries = [
			createEntry("already-reviewed.ts", [{ oldStart: 1, additions: 8, deletions: 2 }]),
			createEntry("left-to-review.ts", [{ oldStart: 1, additions: 3, deletions: 5 }]),
		];
		const viewedPaths = new Set(["already-reviewed.ts"]);

		const result = computeRemainingPullRequestLineCounts(
			filesOf(entries),
			(path) => viewedPaths.has(path),
			[],
			buildHunkIndex(entries),
		);

		expect(result).toEqual({ linesAdded: 3, linesDeleted: 5 });
	});

	it("subtracts viewed chapter hunks from run-wide remaining lines", () => {
		const entries = [
			createEntry("shared.ts", [
				{ oldStart: 1, additions: 5, deletions: 1 },
				{ oldStart: 20, additions: 3, deletions: 2 },
			]),
			createEntry("unrelated.ts", [{ oldStart: 1, additions: 2, deletions: 1 }]),
		];

		const result = computeRemainingPullRequestLineCounts(
			filesOf(entries),
			() => false,
			[ref("shared.ts", 1)],
			buildHunkIndex(entries),
		);

		expect(result).toEqual({ linesAdded: 5, linesDeleted: 3 });
	});

	it("does not double-subtract the same viewed hunk", () => {
		const entries = [
			createEntry("shared.ts", [
				{ oldStart: 1, additions: 5, deletions: 1 },
				{ oldStart: 20, additions: 3, deletions: 2 },
			]),
		];

		const result = computeRemainingPullRequestLineCounts(
			filesOf(entries),
			() => false,
			[ref("shared.ts", 1), ref("shared.ts", 1)],
			buildHunkIndex(entries),
		);

		expect(result).toEqual({ linesAdded: 3, linesDeleted: 2 });
	});

	it("subtracts a fully viewed file only once when chapter hunks are also viewed", () => {
		const entries = [
			createEntry("viewed.ts", [{ oldStart: 1, additions: 5, deletions: 1 }]),
			createEntry("left.ts", [{ oldStart: 1, additions: 2, deletions: 2 }]),
		];

		const result = computeRemainingPullRequestLineCounts(
			filesOf(entries),
			(path) => path === "viewed.ts",
			[ref("viewed.ts", 1)],
			buildHunkIndex(entries),
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
		const entries = [
			createEntry("shared.ts", [
				{ oldStart: 1, additions: 5, deletions: 1 },
				{ oldStart: 50, additions: 3, deletions: 3 },
			]),
		];
		const chapters: ChapterHunkReferences[] = [
			{ externalId: "a", hunkRefs: [ref("shared.ts", 1)] },
			{ externalId: "b", hunkRefs: [ref("shared.ts", 50)] },
		];

		const viewedHunkRefs = collectViewedChapterHunkRefs(chapters, new Set(["a"]), NO_VIEWED_FILES);
		const result = computeRemainingPullRequestLineCounts(
			filesOf(entries),
			() => false,
			viewedHunkRefs,
			buildHunkIndex(entries),
		);

		expect(result).toEqual({ linesAdded: 3, linesDeleted: 3 });
	});

	it("leaves hunks that no chapter covers remaining even when all of a file's chapters are viewed", () => {
		// hunk 99 is orphaned: it belongs to no chapter, so viewing every chapter
		// that references shared.ts must not subtract it.
		const entries = [
			createEntry("shared.ts", [
				{ oldStart: 1, additions: 4, deletions: 1 },
				{ oldStart: 50, additions: 4, deletions: 1 },
				{ oldStart: 99, additions: 2, deletions: 0 },
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
			filesOf(entries),
			() => false,
			viewedHunkRefs,
			buildHunkIndex(entries),
		);

		expect(result).toEqual({ linesAdded: 2, linesDeleted: 0 });
	});

	it("subtracts the whole file only when it is genuinely whole-file viewed", () => {
		const entries = [
			createEntry("shared.ts", [
				{ oldStart: 1, additions: 4, deletions: 1 },
				{ oldStart: 50, additions: 4, deletions: 1 },
				{ oldStart: 99, additions: 2, deletions: 0 },
			]),
		];

		const result = computeRemainingPullRequestLineCounts(
			filesOf(entries),
			(path) => path === "shared.ts",
			[],
			buildHunkIndex(entries),
		);

		expect(result).toEqual({ linesAdded: 0, linesDeleted: 0 });
	});
});
