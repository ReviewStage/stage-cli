import { DIFF_SIDE, type DiffSide } from "@stagereview/types/chapters";

/**
 * Comment counts for file trees and chapter lists, mirroring the hosted app's
 * `buildFileCommentCountsMap`/`buildChapterCommentCountsMap`. The hosted app
 * counts root GitHub review comments; the CLI's review model already groups
 * comments into line-anchored threads (one thread = one root comment), so a
 * thread counts toward the file it is anchored to and — like hosted's
 * `commentMatchesHunk` — toward every chapter with a hunk whose line range
 * contains the thread's anchor on its side.
 */

export interface CommentThreadLike {
	filePath: string;
	side: DiffSide;
	endLine: number;
}

export function buildFileCommentCountsMap(
	files: readonly { path: string }[],
	threads: readonly CommentThreadLike[],
): Map<string, number> {
	const counts = new Map<string, number>(files.map((file) => [file.path, 0]));

	for (const thread of threads) {
		const current = counts.get(thread.filePath);
		if (current !== undefined) counts.set(thread.filePath, current + 1);
	}

	return counts;
}

/** A hunk's line ranges on both sides, as parsed from its `@@` header. */
export interface HunkRange {
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
}

/** Maps filePath → oldStart → the hunk's line ranges for O(1) hunk resolution. */
export type HunkRangeIndex = Map<string, Map<number, HunkRange>>;

/** The subset of Pierre's `FileDiffMetadata` the range index needs. */
export interface HunkRangeSource {
	name: string;
	hunks: readonly {
		deletionStart: number;
		deletionCount: number;
		additionStart: number;
		additionCount: number;
	}[];
}

/**
 * Indexes each parsed file's hunk ranges by old-side start line, the CLI
 * counterpart of hosted's `buildHunkIndex` (`HunkReference.oldStart` is the
 * lookup key in both). Pierre's `deletionStart`/`deletionCount` are the hunk
 * header's old-side range and `additionStart`/`additionCount` the new side.
 */
export function buildHunkRangeIndex(files: readonly HunkRangeSource[]): HunkRangeIndex {
	const index: HunkRangeIndex = new Map();
	for (const file of files) {
		const byOldStart = new Map<number, HunkRange>();
		for (const hunk of file.hunks) {
			byOldStart.set(hunk.deletionStart, {
				oldStart: hunk.deletionStart,
				oldLines: hunk.deletionCount,
				newStart: hunk.additionStart,
				newLines: hunk.additionCount,
			});
		}
		index.set(file.name, byOldStart);
	}
	return index;
}

/**
 * Mirrors hosted's `commentMatchesHunk` for the CLI's thread model: a thread's
 * anchor line (`endLine`, GitHub's `line`) must fall inside the hunk's range
 * on the thread's side. The CLI has no file-level or outdated (line-less)
 * threads, so hosted's fallbacks for those don't apply.
 */
function threadMatchesHunk(thread: CommentThreadLike, hunk: HunkRange): boolean {
	if (thread.side === DIFF_SIDE.DELETIONS) {
		return thread.endLine >= hunk.oldStart && thread.endLine < hunk.oldStart + hunk.oldLines;
	}
	return thread.endLine >= hunk.newStart && thread.endLine < hunk.newStart + hunk.newLines;
}

interface ChapterCommentSource {
	id: string;
	hunkRefs: ReadonlyArray<{ filePath: string; oldStart: number }>;
}

interface ResolvedHunkRange {
	filePath: string;
	hunk: HunkRange;
}

/** Resolves a chapter's hunk refs against the index, deduped by file + oldStart. */
function resolveChapterHunkRanges(
	hunkRefs: ChapterCommentSource["hunkRefs"],
	index: HunkRangeIndex,
): ResolvedHunkRange[] {
	const result: ResolvedHunkRange[] = [];
	const seen = new Map<string, Set<number>>();
	for (const ref of hunkRefs) {
		const fileSet = seen.get(ref.filePath);
		if (fileSet?.has(ref.oldStart)) continue;
		if (fileSet) {
			fileSet.add(ref.oldStart);
		} else {
			seen.set(ref.filePath, new Set([ref.oldStart]));
		}
		const hunk = index.get(ref.filePath)?.get(ref.oldStart);
		if (!hunk) continue;
		result.push({ filePath: ref.filePath, hunk });
	}
	return result;
}

export function buildChapterCommentCountsMap(
	chapters: readonly ChapterCommentSource[],
	index: HunkRangeIndex,
	threads: readonly CommentThreadLike[],
): Map<string, number> {
	const counts = new Map<string, number>(chapters.map((chapter) => [chapter.id, 0]));
	if (threads.length === 0) return counts;

	for (const chapter of chapters) {
		const hunks = resolveChapterHunkRanges(chapter.hunkRefs, index);

		let count = 0;
		for (const thread of threads) {
			for (const { filePath, hunk } of hunks) {
				if (thread.filePath === filePath && threadMatchesHunk(thread, hunk)) {
					count++;
					break;
				}
			}
		}
		counts.set(chapter.id, count);
	}

	return counts;
}
