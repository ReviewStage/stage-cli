import type { ContextContent, FileDiffMetadata, Hunk } from "@pierre/diffs";
import { FILE_STATUS } from "@/lib/diff-types";
import type { FileDiffEntry } from "@/lib/parse-diff";
import { splitWithNewlines } from "@/lib/split-with-newlines";

/**
 * Full-content previews for moved/renamed files (hosted #1106).
 *
 * A pure rename/move produces a diff with zero hunks, which Pierre renders as
 * an empty box. When the file's full contents are available we synthesize a
 * single context-only hunk covering the whole file so the reviewer can still
 * read it in place.
 *
 * Adapted from hosted `lib/diff/full-file-preview.ts` + `renderable-hunks.ts`:
 * the CLI's newer Pierre stores context blocks as line counts with indices into
 * file-level `additionLines`/`deletionLines` arrays (hosted's older version
 * inlined string arrays per block), and the CLI already has the parsed
 * `FileDiffMetadata` on each entry, so the preview is built directly from it
 * instead of re-parsing via `parseDiffFromFile`.
 */

interface PreviewContents {
	oldText: string;
	newText: string;
}

export function isFullFilePreview(entry: FileDiffEntry): boolean {
	if (entry.diff.hunks.length > 0) return false;
	return entry.file.status === FILE_STATUS.MOVED || entry.file.status === FILE_STATUS.RENAMED;
}

function resolvePreviewContents(
	oldText: string | undefined,
	newText: string | undefined,
): PreviewContents | undefined {
	if (oldText !== undefined && newText !== undefined) {
		return { oldText, newText };
	}
	if (newText !== undefined) {
		return { oldText: newText, newText };
	}
	if (oldText !== undefined) {
		return { oldText, newText: oldText };
	}
	return undefined;
}

function formatHunkRange(startLine: number, lineCount: number): string {
	return lineCount === 1 ? String(startLine) : `${startLine},${lineCount}`;
}

function splitSnippetLines(snippet: string): string[] {
	const lines = splitWithNewlines(snippet);
	if (lines) return lines;
	return [""];
}

export function ensureDiffHasRenderableHunks(
	fileDiff: FileDiffMetadata,
	sourceSnippet: string,
): FileDiffMetadata {
	if (fileDiff.hunks.length > 0) return fileDiff;

	const lines = splitSnippetLines(sourceSnippet);
	const lineCount = lines.length;
	const hunkContent: ContextContent[] = [
		{
			type: "context",
			lines: lineCount,
			additionLineIndex: 0,
			deletionLineIndex: 0,
		},
	];
	const hunkSpecs = `@@ -${formatHunkRange(1, lineCount)} +${formatHunkRange(1, lineCount)} @@`;
	const hunk: Hunk = {
		collapsedBefore: 0,
		additionStart: 1,
		additionCount: lineCount,
		additionLines: 0,
		additionLineIndex: 0,
		deletionStart: 1,
		deletionCount: lineCount,
		deletionLines: 0,
		deletionLineIndex: 0,
		hunkContent,
		hunkSpecs,
		splitLineStart: 0,
		splitLineCount: lineCount,
		unifiedLineStart: 0,
		unifiedLineCount: lineCount,
		noEOFCRDeletions: false,
		noEOFCRAdditions: false,
	};

	return {
		...fileDiff,
		hunks: [hunk],
		splitLineCount: lineCount,
		unifiedLineCount: lineCount,
		isPartial: false,
		deletionLines: lines,
		additionLines: lines,
	};
}

export function buildFullFilePreviewDiff(
	entry: FileDiffEntry,
	oldText: string | undefined,
	newText: string | undefined,
): FileDiffMetadata | undefined {
	if (!isFullFilePreview(entry)) return undefined;

	const contents = resolvePreviewContents(oldText, newText);
	if (!contents) return undefined;

	return ensureDiffHasRenderableHunks(entry.diff, contents.oldText);
}
