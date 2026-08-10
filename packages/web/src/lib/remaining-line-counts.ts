import type { HunkReference } from "@stagereview/types/chapters";
import type { PullRequestFile } from "@/lib/diff-types";
import type { FileDiffEntry } from "@/lib/parse-diff";

export interface LineCounts {
	linesAdded: number;
	linesDeleted: number;
}

/** Maps filePath → oldStart → the hunk's line counts for O(1) hunk resolution. */
export type HunkIndex = Map<string, Map<number, LineCounts>>;

export interface ResolvedHunk {
	counts: LineCounts;
	filePath: string;
}

/**
 * Indexes each file's hunks by old-side start line. The CLI keeps hunks on the
 * parsed Pierre diff — `PullRequestFile.hunks` is always empty (unlike the
 * hosted app's wire format) — so the index is built from `FileDiffEntry.diff`:
 * `deletionStart` is the hunk's old start, matching `HunkReference.oldStart`,
 * and `additionLines`/`deletionLines` are its changed-line counts.
 */
export function buildHunkIndex(entries: readonly FileDiffEntry[]): HunkIndex {
	const index: HunkIndex = new Map();
	for (const { file, diff } of entries) {
		const byOldStart = new Map<number, LineCounts>();
		for (const hunk of diff.hunks) {
			byOldStart.set(hunk.deletionStart, {
				linesAdded: hunk.additionLines,
				linesDeleted: hunk.deletionLines,
			});
		}
		index.set(file.path, byOldStart);
	}
	return index;
}

export function resolveChapterHunks(hunkRefs: HunkReference[], index: HunkIndex): ResolvedHunk[] {
	const result: ResolvedHunk[] = [];
	const seen = new Map<string, Set<number>>();
	for (const ref of hunkRefs) {
		const fileSet = seen.get(ref.filePath);
		if (fileSet?.has(ref.oldStart)) continue;
		if (fileSet) {
			fileSet.add(ref.oldStart);
		} else {
			seen.set(ref.filePath, new Set([ref.oldStart]));
		}
		const fileHunks = index.get(ref.filePath);
		if (!fileHunks) continue;
		const counts = fileHunks.get(ref.oldStart);
		if (!counts) continue;
		result.push({ counts, filePath: ref.filePath });
	}
	return result;
}

export function sumHunkLineCounts(hunks: ResolvedHunk[]): LineCounts {
	let linesAdded = 0;
	let linesDeleted = 0;

	for (const { counts } of hunks) {
		linesAdded += counts.linesAdded;
		linesDeleted += counts.linesDeleted;
	}

	return { linesAdded, linesDeleted };
}

export function computeFileLineCounts(files: PullRequestFile[]): LineCounts {
	let linesAdded = 0;
	let linesDeleted = 0;

	for (const file of files) {
		linesAdded += file.additions;
		linesDeleted += file.deletions;
	}

	return { linesAdded, linesDeleted };
}

export interface ChapterHunkReferences {
	externalId: string;
	hunkRefs: HunkReference[];
}

/**
 * Collects the hunk references a viewer has already reviewed through chapters.
 *
 * A fully viewed chapter contributes all of its hunk refs; a partially viewed
 * chapter contributes only the refs whose file is viewed. A file spread across
 * many chapters therefore only has its viewed hunks counted — the caller must
 * not treat such a file as whole-file viewed, or hunks that no chapter covers
 * would be subtracted despite never being shown.
 *
 * Chapters are keyed by `externalId` and file views by path, matching the
 * CLI's view-state (the hosted app keys chapters by id and resolves per-chapter
 * file viewed state through GitHub's sync instead).
 */
export function collectViewedChapterHunkRefs(
	chapters: readonly ChapterHunkReferences[],
	viewedChapterIds: ReadonlySet<string>,
	viewedFilePaths: ReadonlySet<string>,
): HunkReference[] {
	const refs: HunkReference[] = [];

	for (const chapter of chapters) {
		if (viewedChapterIds.has(chapter.externalId)) {
			refs.push(...chapter.hunkRefs);
			continue;
		}

		for (const ref of chapter.hunkRefs) {
			if (viewedFilePaths.has(ref.filePath)) {
				refs.push(ref);
			}
		}
	}

	return refs;
}

/**
 * Sums the diff lines not yet reviewed: viewed files are excluded entirely,
 * and viewed chapter hunks are subtracted from the files that remain.
 * `resolveChapterHunks` dedupes refs, so a hunk viewed through several
 * chapters is only subtracted once.
 */
export function computeRemainingPullRequestLineCounts(
	files: PullRequestFile[],
	isFileViewed: (path: string) => boolean,
	viewedHunkRefs: HunkReference[],
	hunkIndex: HunkIndex,
): LineCounts {
	const remaining = computeFileLineCounts(files.filter((file) => !isFileViewed(file.path)));
	const viewedHunks = resolveChapterHunks(viewedHunkRefs, hunkIndex).filter(
		({ filePath }) => !isFileViewed(filePath),
	);
	const viewed = sumHunkLineCounts(viewedHunks);

	return {
		linesAdded: remaining.linesAdded - viewed.linesAdded,
		linesDeleted: remaining.linesDeleted - viewed.linesDeleted,
	};
}
