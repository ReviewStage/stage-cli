import type { HunkReference } from "@stagereview/types/chapters";
import type { HunkRecord, PullRequestFile } from "@/lib/diff-types";

export interface LineCounts {
	linesAdded: number;
	linesDeleted: number;
}

/** Maps filePath → oldStart → hunk for O(1) hunk resolution. */
export type HunkIndex = Map<string, Map<number, HunkRecord>>;

export interface ResolvedHunk {
	hunk: HunkRecord;
	filePath: string;
}

export function buildHunkIndex(files: PullRequestFile[]): HunkIndex {
	const index: HunkIndex = new Map();
	for (const file of files) {
		const byOldStart = new Map<number, HunkRecord>();
		for (const hunk of file.hunks) {
			byOldStart.set(hunk.oldStart, hunk);
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
		const hunk = fileHunks.get(ref.oldStart);
		if (!hunk) continue;
		result.push({ hunk, filePath: ref.filePath });
	}
	return result;
}

export function sumHunkLineCounts(hunks: ResolvedHunk[]): LineCounts {
	let linesAdded = 0;
	let linesDeleted = 0;

	for (const { hunk } of hunks) {
		for (const line of hunk.lines) {
			if (line.type === "addition") linesAdded++;
			if (line.type === "deletion") linesDeleted++;
		}
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
