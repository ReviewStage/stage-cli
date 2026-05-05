import { getSingularPatch, parseDiffFromFile } from "@pierre/diffs";
import type { HunkReference } from "@stagereview/types/chapters";
import type { FileContentsMap } from "@stagereview/types/diff";
import type { FileDiffEntry } from "./parse-diff";
import { fileDiffToPullRequestFile } from "./parse-diff";

const HUNK_HEADER_RE = /^@@\s+-(\d+)(?:,(\d+))?\s+\+\d+(?:,\d+)?\s+@@/;
const FILE_BREAK = /\ndiff --git /g;

interface FileSegment {
	prevName?: string;
	name?: string;
	text: string;
}

function splitPatchByFile(patch: string): FileSegment[] {
	if (!patch.trim()) return [];
	const parts = patch.split(FILE_BREAK);
	const segments: FileSegment[] = [];
	for (let i = 0; i < parts.length; i++) {
		const text = i === 0 ? parts[i] : `diff --git ${parts[i]}`;
		if (text === undefined) continue;
		if (!text.startsWith("diff --git ")) continue;
		segments.push({ ...parseFileNames(text), text });
	}
	return segments;
}

const DIFF_GIT_NAMES_RE = /^diff --git a\/(.+?) b\/(.+?)$/m;
const PLUS_NAME_RE = /^\+\+\+ (?:b\/)?(.+)$/m;
const MINUS_NAME_RE = /^--- (?:a\/)?(.+)$/m;

function parseFileNames(segment: string): { prevName?: string; name?: string } {
	const plusMatch = segment.match(PLUS_NAME_RE);
	const minusMatch = segment.match(MINUS_NAME_RE);
	const gitMatch = segment.match(DIFF_GIT_NAMES_RE);
	const name =
		plusMatch?.[1] && plusMatch[1] !== "/dev/null" ? plusMatch[1] : (gitMatch?.[2] ?? undefined);
	const prevName =
		minusMatch?.[1] && minusMatch[1] !== "/dev/null" ? minusMatch[1] : (gitMatch?.[1] ?? undefined);
	return { prevName, name };
}

interface ParsedHunk {
	oldStart: number;
	oldLines: number;
	lines: string[];
}

function parseHunksFromSegment(segmentText: string): ParsedHunk[] {
	const lines = segmentText.split("\n");
	const hunks: ParsedHunk[] = [];
	let current: ParsedHunk | null = null;

	for (const line of lines) {
		const match = line.match(HUNK_HEADER_RE);
		if (match) {
			if (current) hunks.push(current);
			const oldStart = match[1] === undefined ? 0 : Number.parseInt(match[1], 10);
			const oldLines = match[2] === undefined ? 1 : Number.parseInt(match[2], 10);
			current = { oldStart, oldLines, lines: [] };
			continue;
		}
		if (current) current.lines.push(line);
	}
	if (current) hunks.push(current);

	return hunks;
}

/**
 * Apply hunks to old file content, producing an intermediate file.
 *
 * Used in chapter view: applying all NON-chapter hunks to the old file produces
 * a base where only the chapter's changes remain as the diff against the new file.
 *
 * Hunks are applied bottom-to-top (by descending oldStart) so that each splice
 * doesn't shift the positions of earlier hunks.
 */
function applyHunksToContent(content: string, hunks: ParsedHunk[]): string {
	if (hunks.length === 0) return content;

	const trailingNewline = content.endsWith("\n");
	const fileLines =
		content === "" ? [] : trailingNewline ? content.slice(0, -1).split("\n") : content.split("\n");

	const sorted = [...hunks].sort((a, b) => b.oldStart - a.oldStart);

	for (const hunk of sorted) {
		const newContent: string[] = [];
		for (const line of hunk.lines) {
			if (line.startsWith("+")) {
				newContent.push(line.slice(1));
			} else if (line.startsWith("-")) {
				// deletion — skip (don't include in output)
			} else if (line.startsWith(" ") || line === "") {
				newContent.push(line.startsWith(" ") ? line.slice(1) : line);
			}
		}

		const spliceStart = hunk.oldLines === 0 ? hunk.oldStart : hunk.oldStart - 1;
		fileLines.splice(spliceStart, hunk.oldLines, ...newContent);
	}

	return fileLines.length > 0 ? fileLines.join("\n") + (trailingNewline ? "\n" : "") : "";
}

/**
 * Filter a parsed PR diff to the files+hunks referenced by a chapter's hunkRefs.
 *
 * When file contents are available, computes an intermediate file by applying
 * non-chapter hunks to the old content, then diffs intermediate vs new. This
 * produces a clean isPartial=false diff that supports context expansion.
 *
 * File order follows hunkRef first-appearance — that's the LLM's intended
 * reading order for the chapter, not the file tree's alphabetical order.
 */
export function filterFilesForChapter(
	patch: string,
	hunkRefs: readonly HunkReference[],
	fileContents?: FileContentsMap,
): FileDiffEntry[] {
	if (hunkRefs.length === 0) return [];

	const oldStartsByPath = new Map<string, Set<number>>();
	for (const ref of hunkRefs) {
		let set = oldStartsByPath.get(ref.filePath);
		if (!set) {
			set = new Set();
			oldStartsByPath.set(ref.filePath, set);
		}
		set.add(ref.oldStart);
	}

	const segments = splitPatchByFile(patch);
	const segmentsByPath = new Map<string, FileSegment>();
	for (const segment of segments) {
		if (segment.name) segmentsByPath.set(segment.name, segment);
		if (segment.prevName && segment.prevName !== segment.name) {
			segmentsByPath.set(segment.prevName, segment);
		}
	}

	const result: FileDiffEntry[] = [];
	for (const [filePath, chapterOldStarts] of oldStartsByPath) {
		const segment = segmentsByPath.get(filePath);
		if (!segment) continue;

		const allHunks = parseHunksFromSegment(segment.text);
		const chapterHunks = allHunks.filter((h) => chapterOldStarts.has(h.oldStart));
		if (chapterHunks.length === 0) continue;

		const contents = fileContents?.[segment.name ?? filePath];
		if (contents?.oldContent != null && contents?.newContent != null) {
			const nonChapterHunks = allHunks.filter((h) => !chapterOldStarts.has(h.oldStart));
			const intermediateContent = applyHunksToContent(contents.oldContent, nonChapterHunks);
			const oldPath = segment.prevName ?? segment.name ?? filePath;
			const newPath = segment.name ?? filePath;
			const diff = parseDiffFromFile(
				{ name: oldPath, contents: intermediateContent },
				{ name: newPath, contents: contents.newContent },
			);
			result.push({ file: fileDiffToPullRequestFile(diff), diff });
		} else {
			const headerLines: string[] = [];
			const lines = segment.text.split("\n");
			for (const line of lines) {
				if (HUNK_HEADER_RE.test(line)) break;
				headerLines.push(line);
			}
			const filteredText = [
				...headerLines,
				...chapterHunks.flatMap((h) => {
					const header = `@@ -${h.oldStart},${h.oldLines} +0,0 @@`;
					return [header, ...h.lines];
				}),
			].join("\n");
			const diff = getSingularPatch(filteredText);
			result.push({ file: fileDiffToPullRequestFile(diff), diff });
		}
	}

	return result;
}
