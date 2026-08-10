import type { HunkReference, RiskLevel } from "@stagereview/types/chapters";
import { HEADER_ONLY_OLD_START } from "@stagereview/types/chapters";
import type { PullRequestFile } from "@stagereview/types/parsed-diff";
import type { KeyChange } from "./schema.js";

export const OTHER_CHANGES_CHAPTER_ID = "chapter-other-changes";
const OTHER_CHANGES_TITLE = "Other changes";
const OTHER_CHANGES_SUMMARY =
	"Lockfiles, generated files, binary assets, and other ignored files, plus pure renames or moves not covered by other chapters.";

export interface OtherChangesChapter {
	id: string;
	title: string;
	summary: string;
	hunkRefs: HunkReference[];
	keyChanges: KeyChange[];
	riskLevel: RiskLevel | null;
	riskReasons: string[];
}

/**
 * Synthesize a static catch-all chapter for files the LLM cannot process:
 * files filtered out by path (lockfiles, images, etc.) and header-only files
 * with no hunks (pure renames/moves, patch-truncated files). Returns null when
 * every file has hunks and none were path-excluded. Walks `allFiles` so hunkRef
 * ordering matches the PR's file order, which is stable across runs.
 * Callers assign `order` when appending the chapter to the run.
 */
export function buildOtherChangesChapter(
	allFiles: PullRequestFile[],
	excludedByPath: string[],
): OtherChangesChapter | null {
	const excluded = new Set(excludedByPath);
	const hunkRefs: HunkReference[] = [];

	for (const file of allFiles) {
		if (!excluded.has(file.path) && file.hunks.length > 0) continue;

		if (file.hunks.length > 0) {
			for (const hunk of file.hunks) {
				hunkRefs.push({ filePath: file.path, oldStart: hunk.oldStart });
			}
		} else {
			hunkRefs.push({ filePath: file.path, oldStart: HEADER_ONLY_OLD_START });
		}
	}

	if (hunkRefs.length === 0) return null;

	return makeOtherChangesChapter(hunkRefs);
}

/** The static catch-all chapter shell around a caller-supplied set of hunkRefs. */
export function makeOtherChangesChapter(hunkRefs: HunkReference[]): OtherChangesChapter {
	return {
		id: OTHER_CHANGES_CHAPTER_ID,
		title: OTHER_CHANGES_TITLE,
		summary: OTHER_CHANGES_SUMMARY,
		hunkRefs,
		keyChanges: [],
		riskLevel: null,
		riskReasons: [],
	};
}
