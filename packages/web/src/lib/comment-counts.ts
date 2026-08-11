import { DIFF_SIDE, type DiffSide, HEADER_ONLY_OLD_START } from "@stagereview/types/chapters";
import { SUBJECT_TYPE, type SubjectType } from "@stagereview/types/review";

/**
 * Comment counts for file trees and chapter lists. The CLI's review model
 * groups comments into line-anchored threads (one thread = one root comment),
 * so a thread counts toward the file it is anchored to and toward every
 * chapter with a hunk whose line range contains the thread's anchor on its
 * side. Whole-file threads have no anchor and count toward every chapter
 * containing any hunk of their file.
 */

export interface CommentThreadLike {
	filePath: string;
	side: DiffSide;
	/** Null for whole-file GitHub threads and outdated line threads. */
	endLine: number | null;
	/** Absent on local threads, which are always line-anchored. */
	subjectType?: SubjectType;
	/** An outdated line thread's frozen original anchor (GitHub's `original_line`). */
	originalLine?: number | null;
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
 * Indexes each parsed file's hunk ranges by old-side start line
 * (`HunkReference.oldStart` is the lookup key). Pierre's
 * `deletionStart`/`deletionCount` are the hunk header's old-side range and
 * `additionStart`/`additionCount` the new side.
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
 * A line thread's anchor (`endLine`, GitHub's `line`) must fall inside the
 * hunk's range on the thread's side. Whole-file threads are matched by path
 * before this runs. Outdated threads (GitHub nulled their `line` once the
 * code moved) fall back to the frozen original anchor (`original_line`)
 * against the hunk's old-file range.
 */
function threadMatchesHunk(thread: CommentThreadLike, hunk: HunkRange): boolean {
	if (thread.endLine === null) {
		return (
			thread.originalLine != null &&
			thread.originalLine >= hunk.oldStart &&
			thread.originalLine < hunk.oldStart + hunk.oldLines
		);
	}
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
		// FILE threads match by path, restricted to what the chapter renders
		// (mirrors filterFilesForChapter): paths with a resolved hunk, plus
		// header-only sentinel refs for files the diff parsed with zero hunks
		// (binary changes, pure renames). Invalid refs stay ignored.
		const chapterPaths = new Set(hunks.map((resolved) => resolved.filePath));
		for (const ref of chapter.hunkRefs) {
			if (ref.oldStart !== HEADER_ONLY_OLD_START) continue;
			if (index.get(ref.filePath)?.size === 0) chapterPaths.add(ref.filePath);
		}

		let count = 0;
		for (const thread of threads) {
			if (thread.subjectType === SUBJECT_TYPE.FILE) {
				if (chapterPaths.has(thread.filePath)) count++;
				continue;
			}
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
