import type { FileDiffMetadata, Hunk } from "@pierre/diffs";
import { describe, expect, it } from "vitest";
import { FILE_STATUS, type PullRequestFile } from "@/lib/diff-types";
import { buildFullFilePreviewDiff, isFullFilePreview } from "@/lib/full-file-preview";
import type { FileDiffEntry } from "@/lib/parse-diff";

function makeHunk(): Hunk {
	return {
		collapsedBefore: 0,
		additionStart: 1,
		additionCount: 1,
		additionLines: 1,
		additionLineIndex: 0,
		deletionStart: 1,
		deletionCount: 1,
		deletionLines: 1,
		deletionLineIndex: 0,
		hunkContent: [
			{ type: "change", additions: 1, additionLineIndex: 0, deletions: 1, deletionLineIndex: 0 },
		],
		hunkSpecs: "@@ -1 +1 @@",
		splitLineStart: 0,
		splitLineCount: 1,
		unifiedLineStart: 0,
		unifiedLineCount: 2,
		noEOFCRDeletions: false,
		noEOFCRAdditions: false,
	};
}

function makeEntry(
	overrides: { file?: Partial<PullRequestFile>; diff?: Partial<FileDiffMetadata> } = {},
): FileDiffEntry {
	const file: PullRequestFile = {
		path: "src/new-name.ts",
		oldPath: "src/old-name.ts",
		filename: "new-name.ts",
		status: FILE_STATUS.MOVED,
		additions: 0,
		deletions: 0,
		hunks: [],
		...overrides.file,
	};
	const diff: FileDiffMetadata = {
		name: "src/new-name.ts",
		prevName: "src/old-name.ts",
		type: "rename-pure",
		hunks: [],
		splitLineCount: 0,
		unifiedLineCount: 0,
		isPartial: true,
		deletionLines: [],
		additionLines: [],
		...overrides.diff,
	};
	return { file, diff };
}

describe("isFullFilePreview", () => {
	it("matches zero-hunk moved and renamed files", () => {
		expect(isFullFilePreview(makeEntry({ file: { status: FILE_STATUS.MOVED } }))).toBe(true);
		expect(isFullFilePreview(makeEntry({ file: { status: FILE_STATUS.RENAMED } }))).toBe(true);
	});

	it("does not match files that already have hunks", () => {
		const entry = makeEntry({
			file: { status: FILE_STATUS.RENAMED },
			diff: { type: "rename-changed", hunks: [makeHunk()] },
		});

		expect(isFullFilePreview(entry)).toBe(false);
	});

	it("does not match other statuses", () => {
		expect(
			isFullFilePreview(
				makeEntry({ file: { status: FILE_STATUS.MODIFIED }, diff: { type: "change" } }),
			),
		).toBe(false);
		expect(
			isFullFilePreview(makeEntry({ file: { status: FILE_STATUS.ADDED }, diff: { type: "new" } })),
		).toBe(false);
	});
});

describe("buildFullFilePreviewDiff", () => {
	it("builds context-only hunks from fetched content for pure moved files", () => {
		const diff = buildFullFilePreviewDiff(makeEntry(), "export const value = 1;\n", undefined);

		expect(diff).toBeDefined();
		if (!diff) throw new Error("Expected full-file preview diff");
		expect(diff.name).toBe("src/new-name.ts");
		expect(diff.prevName).toBe("src/old-name.ts");
		expect(diff.isPartial).toBe(false);
		expect(diff.deletionLines).toEqual(["export const value = 1;\n"]);
		expect(diff.additionLines).toEqual(["export const value = 1;\n"]);
		expect(diff.hunks).toHaveLength(1);
		expect(diff.hunks[0]).toMatchObject({
			additionStart: 1,
			additionCount: 1,
			additionLines: 0,
			deletionStart: 1,
			deletionCount: 1,
			deletionLines: 0,
			hunkSpecs: "@@ -1 +1 @@",
		});
		expect(diff.hunks[0]?.hunkContent).toEqual([
			{ type: "context", lines: 1, additionLineIndex: 0, deletionLineIndex: 0 },
		]);
	});

	it("spans every line of a multi-line file", () => {
		const diff = buildFullFilePreviewDiff(makeEntry(), "a\nb\nc", undefined);

		expect(diff?.hunks[0]).toMatchObject({
			additionCount: 3,
			deletionCount: 3,
			hunkSpecs: "@@ -1,3 +1,3 @@",
		});
		expect(diff?.additionLines).toEqual(["a\n", "b\n", "c"]);
	});

	it("mirrors the available side when only one is present", () => {
		const fromNew = buildFullFilePreviewDiff(makeEntry(), undefined, "new side\n");
		expect(fromNew?.deletionLines).toEqual(["new side\n"]);
		expect(fromNew?.additionLines).toEqual(["new side\n"]);
	});

	it("returns undefined until at least one side of file content is available", () => {
		expect(buildFullFilePreviewDiff(makeEntry(), undefined, undefined)).toBeUndefined();
	});

	it("returns undefined for non-preview files", () => {
		const entry = makeEntry({
			file: { status: FILE_STATUS.MODIFIED },
			diff: { type: "change", hunks: [makeHunk()] },
		});
		expect(buildFullFilePreviewDiff(entry, "content\n", "content\n")).toBeUndefined();
	});
});
