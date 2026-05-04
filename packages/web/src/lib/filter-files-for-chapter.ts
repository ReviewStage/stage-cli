import { getSingularPatch } from "@pierre/diffs";
import type { HunkReference } from "@stagereview/types/chapters";
import type { FileDiffEntry } from "./parse-diff";
import { fileDiffToPullRequestFile } from "./parse-diff";

const HUNK_HEADER_RE = /^@@\s+-(\d+)(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/;
const FILE_BREAK = /\ndiff --git /g;

interface FileSegment {
	prevName?: string;
	name?: string;
	text: string;
}

/**
 * Splits a `git diff` patch into per-file blocks, keyed by both the new path
 * (post-rename) and the old path so a chapter `hunkRef` can match either.
 * Splitting at the text level (rather than reconstructing from Pierre's parsed
 * metadata) preserves the file-level headers Pierre needs to re-parse cleanly.
 */
function splitPatchByFile(patch: string): FileSegment[] {
	if (!patch.trim()) return [];
	// Split on every "\ndiff --git " boundary. Re-prepend the prefix to all
	// segments after the first so each block starts with a valid file header.
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
	// Prefer the +++/--- lines because they're authoritative; fall back to the
	// `diff --git` header for added/deleted files where one side is /dev/null.
	const plusMatch = segment.match(PLUS_NAME_RE);
	const minusMatch = segment.match(MINUS_NAME_RE);
	const gitMatch = segment.match(DIFF_GIT_NAMES_RE);
	const name =
		plusMatch?.[1] && plusMatch[1] !== "/dev/null" ? plusMatch[1] : (gitMatch?.[2] ?? undefined);
	const prevName =
		minusMatch?.[1] && minusMatch[1] !== "/dev/null" ? minusMatch[1] : (gitMatch?.[1] ?? undefined);
	return { prevName, name };
}

/**
 * Filter a per-file patch text down to only the hunks whose old-side start
 * matches one of the provided line numbers. Returns null when no hunk matches.
 */
function filterHunksInFile(perFileText: string, oldStarts: ReadonlySet<number>): string | null {
	const lines = perFileText.split("\n");
	const headerLines: string[] = [];
	const hunks: Array<{ oldStart: number; lines: string[] }> = [];
	let current: { oldStart: number; lines: string[] } | null = null;

	for (const line of lines) {
		const match = line.match(HUNK_HEADER_RE);
		if (match) {
			if (current) hunks.push(current);
			const start = match[1] === undefined ? Number.NaN : Number.parseInt(match[1], 10);
			current = { oldStart: start, lines: [line] };
			continue;
		}
		if (current) current.lines.push(line);
		else headerLines.push(line);
	}
	if (current) hunks.push(current);

	const matched = hunks.filter((h) => oldStarts.has(h.oldStart));
	if (matched.length === 0) return null;

	return [...headerLines, ...matched.flatMap((h) => h.lines)].join("\n");
}

/**
 * Filter a parsed PR diff to the files+hunks referenced by a chapter's hunkRefs.
 *
 * File order follows hunkRef first-appearance — that's the LLM's intended
 * reading order for the chapter, not the file tree's alphabetical order.
 */
export function filterFilesForChapter(
	patch: string,
	hunkRefs: readonly HunkReference[],
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
		// Index the previous path too so renames whose hunkRefs use the old path still resolve.
		if (segment.prevName && segment.prevName !== segment.name) {
			segmentsByPath.set(segment.prevName, segment);
		}
	}

	const result: FileDiffEntry[] = [];
	for (const [filePath, oldStarts] of oldStartsByPath) {
		const segment = segmentsByPath.get(filePath);
		if (!segment) continue;

		const filteredText = filterHunksInFile(segment.text, oldStarts);
		if (filteredText === null) continue;

		const diff = getSingularPatch(filteredText);
		result.push({ file: fileDiffToPullRequestFile(diff), diff });
	}

	return result;
}
