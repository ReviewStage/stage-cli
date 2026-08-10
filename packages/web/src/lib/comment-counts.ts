/**
 * Comment counts for file trees and chapter lists, mirroring the hosted app's
 * `buildFileCommentCountsMap`/`buildChapterCommentCountsMap`. The hosted app
 * counts root GitHub review comments and matches them to hunks by line range;
 * the CLI's review model already groups comments into line-anchored threads
 * (one thread = one root comment), so a thread counts toward the file it is
 * anchored to and toward every chapter whose hunk refs include that file.
 */

export interface CommentThreadLike {
	filePath: string;
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

interface ChapterCommentSource {
	id: string;
	hunkRefs: ReadonlyArray<{ filePath: string }>;
}

export function buildChapterCommentCountsMap(
	chapters: readonly ChapterCommentSource[],
	threads: readonly CommentThreadLike[],
): Map<string, number> {
	const counts = new Map<string, number>(chapters.map((chapter) => [chapter.id, 0]));
	if (threads.length === 0) return counts;

	const threadCountsByPath = new Map<string, number>();
	for (const thread of threads) {
		threadCountsByPath.set(thread.filePath, (threadCountsByPath.get(thread.filePath) ?? 0) + 1);
	}

	for (const chapter of chapters) {
		const filePaths = new Set(chapter.hunkRefs.map((ref) => ref.filePath));
		let count = 0;
		for (const path of filePaths) {
			count += threadCountsByPath.get(path) ?? 0;
		}
		counts.set(chapter.id, count);
	}

	return counts;
}
