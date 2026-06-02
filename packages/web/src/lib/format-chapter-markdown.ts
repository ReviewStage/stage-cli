import type { Chapter } from "@stagereview/types/chapters";
import { FILE_STATUS, type PullRequestFile } from "./diff-types";
import { filterFilesForChapter } from "./filter-files-for-chapter";

interface ChapterFileInput {
	file: PullRequestFile;
}

function formatFileEntry(file: PullRequestFile): string {
	const status = file.status;
	const counts: string[] = [];
	if (file.additions > 0) counts.push(`+${file.additions}`);
	if (file.deletions > 0) counts.push(`-${file.deletions}`);
	const countsStr = counts.length > 0 ? `, ${counts.join(" ")}` : "";

	const isRenamed = status === FILE_STATUS.RENAMED || status === FILE_STATUS.MOVED;
	const path = isRenamed && file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;

	return `- ${path} (${status}${countsStr})`;
}

/**
 * Renders a chapter as portable Markdown for the "Copy chapter summary" action.
 * Uses `chapter.order` (not array index) so the heading matches what the
 * navigator displays, even when chapters have gaps in their `order` values.
 */
export function formatChapterAsMarkdown(
	chapter: Chapter,
	chapterFiles: ChapterFileInput[],
): string {
	const sections: string[] = [];

	sections.push(`# Chapter ${chapter.order}: ${chapter.title}`);

	if (chapter.summary) sections.push(chapter.summary);

	if (chapter.keyChanges.length > 0) {
		const bullets = chapter.keyChanges.map((kc) => `- ${kc.content}`).join("\n");
		sections.push(`## What to Review\n${bullets}`);
	}

	if (chapterFiles.length > 0) {
		const fileLines = chapterFiles.map((cf) => formatFileEntry(cf.file)).join("\n");
		sections.push(`## Files\n${fileLines}`);
	}

	return sections.join("\n\n");
}

/**
 * Renders every chapter (ordered by `chapter.order`) as one Markdown document for
 * the "Copy chapters" action, separated by horizontal rules. Per-chapter file
 * lists are derived from `patch`; when it's empty the file sections are omitted.
 */
export function formatAllChaptersAsMarkdown(chapters: Chapter[], patch: string): string {
	return [...chapters]
		.sort((a, b) => a.order - b.order)
		.map((chapter) =>
			formatChapterAsMarkdown(chapter, filterFilesForChapter(patch, chapter.hunkRefs)),
		)
		.join("\n\n---\n\n");
}
