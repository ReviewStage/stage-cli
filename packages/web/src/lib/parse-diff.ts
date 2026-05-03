import { type FileDiffMetadata, parsePatchFiles } from "@pierre/diffs";
import { useMemo } from "react";
import { FILE_STATUS, type FileStatus, type PullRequestFile } from "./diff-types";

/**
 * `parsePatchFiles` returns one ParsedPatch per `From <commit>` block in the
 * input. `git diff` output (no commit envelope) yields a single ParsedPatch.
 * We flatten across patches so callers see one flat list of files regardless.
 */
export function parsePatchToFileDiffs(patch: string): FileDiffMetadata[] {
	if (!patch.trim()) return [];
	const parsed = parsePatchFiles(patch);
	return parsed.flatMap((p) => p.files);
}

/**
 * Bridge from `@pierre/diffs`'s `FileDiffMetadata` to stage-cli's
 * `PullRequestFile`. Hosted's diff viewer expects `PullRequestFile` shape
 * (path, additions, deletions, status, hunks) — we adapt parsed metadata so
 * the existing FileHeader / FileViewRow components work unchanged.
 */
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
		// FileHeader / parents only consume additions/deletions counts on the
		// PullRequestFile; the actual hunks come from the FileDiffMetadata when
		// rendering. We don't translate them here.
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

export function useFileDiffEntries(patch: string | undefined): FileDiffEntry[] {
	return useMemo(() => {
		if (!patch) return [];
		const diffs = parsePatchToFileDiffs(patch);
		return diffs.map((diff) => ({ file: fileDiffToPullRequestFile(diff), diff }));
	}, [patch]);
}
