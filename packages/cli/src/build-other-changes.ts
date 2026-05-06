import type { HunkReference } from "@stagereview/types/chapters";
import type { PullRequestFile } from "@stagereview/types/parsed-diff";

const OTHER_CHANGES_CHAPTER_ID = "chapter-other-changes";
const OTHER_CHANGES_TITLE = "Other changes";
const OTHER_CHANGES_SUMMARY =
	"Lockfiles, generated files, and binary assets excluded from the chapters.";

export function buildOtherChangesChapter(allFiles: PullRequestFile[], excludedByPath: string[]) {
	if (excludedByPath.length === 0) return null;

	const excluded = new Set(excludedByPath);
	const hunkRefs: HunkReference[] = [];

	for (const file of allFiles) {
		if (!excluded.has(file.path)) continue;
		for (const hunk of file.hunks) {
			hunkRefs.push({ filePath: file.path, oldStart: hunk.oldStart });
		}
	}

	return {
		id: OTHER_CHANGES_CHAPTER_ID,
		title: OTHER_CHANGES_TITLE,
		summary: OTHER_CHANGES_SUMMARY,
		hunkRefs,
		keyChanges: [],
	};
}
