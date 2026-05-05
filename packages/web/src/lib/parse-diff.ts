import { type FileDiffMetadata, type Hunk, parsePatchFiles } from "@pierre/diffs";
import type { FileContentsMap } from "@stagereview/types/diff";
import { useMemo } from "react";
import { FILE_STATUS, type FileStatus, type PullRequestFile } from "./diff-types";
import { splitWithNewlines } from "./split-with-newlines";

// Flatten across ParsedPatch envelopes — `parsePatchFiles` returns one per
// `From <commit>` block, but plain `git diff` output yields a single envelope
// and callers don't need to care which.
export function parsePatchToFileDiffs(patch: string): FileDiffMetadata[] {
	if (!patch.trim()) return [];
	const parsed = parsePatchFiles(patch);
	return parsed.flatMap((p) => p.files);
}

export function fileDiffToPullRequestFile(diff: FileDiffMetadata): PullRequestFile {
	let additions = 0;
	let deletions = 0;
	for (const hunk of diff.hunks) {
		additions += hunk.additionLines;
		deletions += hunk.deletionLines;
	}
	const status = changeTypeToFileStatus(diff.type);
	const path = diff.name;
	const oldPath = diff.prevName;
	return {
		path,
		oldPath: oldPath && oldPath !== path ? oldPath : undefined,
		filename: path.split("/").pop() ?? path,
		status,
		additions,
		deletions,
		// Hunks live on the FileDiffMetadata; PullRequestFile only carries
		// additions/deletions for header rendering, so we don't translate them.
		hunks: [],
	};
}

function changeTypeToFileStatus(type: FileDiffMetadata["type"]): FileStatus {
	switch (type) {
		case "new":
			return FILE_STATUS.ADDED;
		case "deleted":
			return FILE_STATUS.DELETED;
		case "rename-pure":
			return FILE_STATUS.MOVED;
		case "rename-changed":
			return FILE_STATUS.RENAMED;
		case "change":
			return FILE_STATUS.MODIFIED;
	}
}

export interface FileDiffEntry {
	file: PullRequestFile;
	diff: FileDiffMetadata;
}

/**
 * Remap a hunk's line-array indices from partial (sequential offset within the
 * patch-only arrays) to full-file (actual line position). Pierre's hunk headers
 * already carry the 1-based file line numbers (`deletionStart`/`additionStart`);
 * converting to 0-based gives the correct index into the full-file arrays.
 */
function reindexHunk(hunk: Hunk): Hunk {
	let delIdx = hunk.deletionStart - 1;
	let addIdx = hunk.additionStart - 1;

	const reindexedContent = hunk.hunkContent.map((segment) => {
		const patched = { ...segment, deletionLineIndex: delIdx, additionLineIndex: addIdx };
		if (segment.type === "context") {
			delIdx += segment.lines;
			addIdx += segment.lines;
		} else {
			delIdx += segment.deletions;
			addIdx += segment.additions;
		}
		return patched;
	});

	return {
		...hunk,
		deletionLineIndex: hunk.deletionStart - 1,
		additionLineIndex: hunk.additionStart - 1,
		hunkContent: reindexedContent,
	};
}

export function enrichFileDiff(
	diff: FileDiffMetadata,
	fileContents: FileContentsMap | undefined,
): FileDiffMetadata {
	if (!fileContents) return diff;
	const contents = fileContents[diff.name];
	if (!contents) return diff;

	const oldLines = splitWithNewlines(contents.oldContent);
	const newLines = splitWithNewlines(contents.newContent);
	if (!oldLines && !newLines) return diff;

	return {
		...diff,
		isPartial: false,
		hunks: diff.hunks.map(reindexHunk),
		...(oldLines ? { deletionLines: oldLines } : {}),
		...(newLines ? { additionLines: newLines } : {}),
	};
}

export function useFileDiffEntries(
	patch: string | undefined,
	fileContents?: FileContentsMap,
): FileDiffEntry[] {
	return useMemo(() => {
		if (!patch) return [];
		const diffs = parsePatchToFileDiffs(patch);
		return diffs.map((diff) => {
			const enriched = enrichFileDiff(diff, fileContents);
			return { file: fileDiffToPullRequestFile(enriched), diff: enriched };
		});
	}, [patch, fileContents]);
}
