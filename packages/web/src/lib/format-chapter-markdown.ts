import type { Chapter } from "@stage-cli/types/chapters";
import { FILE_STATUS, type PullRequestFile } from "./diff-types";

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
 * Mirrors hosted's `formatChapterAsMarkdown` so output is consistent across
 * stage-cli and the hosted reviewer.
 */
export function formatChapterAsMarkdown(
	chapter: Chapter,
	chapterIndex: number,
	chapterFiles: ChapterFileInput[],
): string {
	const sections: string[] = [];

	sections.push(`# Chapter ${chapterIndex + 1}: ${chapter.title}`);

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
