import type { HunkReference, LineRef } from "@stage-cli/types/chapters";
import { DIFF_SIDE } from "./diff-types";

/**
 * Sort key-change line refs into the chapter's own file order so the fallback
 * scroll target (lineRefs[0]) lands on the earliest on-screen location instead
 * of whatever order the narrative agent happened to emit. Within a file we
 * sort by startLine first — an approximation that's exact within a single
 * side and holds up for typical multi-hunk files. Ties on startLine break like
 * unified view: deletions before additions.
 */
export function sortLineRefsByChapterOrder(
	lineRefs: readonly LineRef[],
	hunkRefs: readonly HunkReference[],
): LineRef[] {
	const fileOrder = new Map<string, number>();
	for (const hunk of hunkRefs) {
		if (!fileOrder.has(hunk.filePath)) fileOrder.set(hunk.filePath, fileOrder.size);
	}
	return [...lineRefs].sort((a, b) => {
		const aRank = fileOrder.get(a.filePath);
		const bRank = fileOrder.get(b.filePath);
		if (aRank !== bRank) {
			if (aRank === undefined) return 1;
			if (bRank === undefined) return -1;
			return aRank - bRank;
		}
		if (a.filePath !== b.filePath) return 0;
		if (a.startLine !== b.startLine) return a.startLine - b.startLine;
		if (a.side !== b.side) return a.side === DIFF_SIDE.DELETIONS ? -1 : 1;
		return a.endLine - b.endLine;
	});
}
