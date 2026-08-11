interface ChapterFileSource {
	externalId: string;
	hunkRefs: ReadonlyArray<{ filePath: string }>;
}

/**
 * Derives the set of chapters that read as viewed.
 *
 * A chapter is viewed when it carries an explicit "viewed" mark, OR when every
 * file it contains is already viewed. The CLI tracks file views as a flat
 * per-run set of paths, so a chapter's file viewed state is membership of each
 * of its (deduped) hunk-ref file paths in that set.
 */
export function deriveViewedChapterIds(
	chapters: readonly ChapterFileSource[],
	explicitViewedChapterIds: Iterable<string>,
	viewedFilePaths: ReadonlySet<string>,
): Set<string> {
	const viewed = new Set(explicitViewedChapterIds);

	for (const chapter of chapters) {
		if (viewed.has(chapter.externalId)) continue;

		const filePaths = [...new Set(chapter.hunkRefs.map((ref) => ref.filePath))];
		if (filePaths.length === 0) continue;

		const allFilesViewed = filePaths.every((path) => viewedFilePaths.has(path));
		if (allFilesViewed) viewed.add(chapter.externalId);
	}

	return viewed;
}
