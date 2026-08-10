import { type FileDiffMetadata, getSingularPatch, parseDiffFromFile } from "@pierre/diffs";
import { HEADER_ONLY_OLD_START, type HunkReference } from "@stagereview/types/chapters";
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

const DIFF_GIT_QUOTED_NAMES_RE = /^diff --git "a\/((?:[^"\\]|\\.)+)" "b\/((?:[^"\\]|\\.)+)"$/m;
const DIFF_GIT_NAMES_RE = /^diff --git a\/(.+?) b\/(.+?)$/m;
const PLUS_NAME_RE = /^\+\+\+ (.+)$/m;
const MINUS_NAME_RE = /^--- (.+)$/m;

/**
 * Decode the C-style escapes git emits inside quoted diff header paths
 * (spaces, non-ASCII under core.quotepath): octal byte escapes reassembled
 * as UTF-8 plus control shorthands. Mirrors the CLI server's decoder.
 */
function decodeQuotedPath(raw: string): string {
	const bytes: number[] = [];
	const encoder = new TextEncoder();
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		if (ch !== "\\") {
			for (const byte of encoder.encode(ch ?? "")) bytes.push(byte);
			continue;
		}
		const next = raw[i + 1];
		if (next === undefined) break;
		const octal = raw.slice(i + 1, i + 4);
		if (/^[0-7]{3}$/.test(octal)) {
			bytes.push(Number.parseInt(octal, 8));
			i += 3;
			continue;
		}
		const shorthand: Record<string, number> = {
			a: 0x07,
			b: 0x08,
			t: 0x09,
			n: 0x0a,
			v: 0x0b,
			f: 0x0c,
			r: 0x0d,
		};
		const code = shorthand[next];
		if (code !== undefined) {
			bytes.push(code);
		} else {
			for (const byte of encoder.encode(next)) bytes.push(byte);
		}
		i += 1;
	}
	return new TextDecoder().decode(new Uint8Array(bytes));
}

function decodeHeaderName(raw: string | undefined, prefix: "a/" | "b/"): string | undefined {
	if (!raw) return undefined;
	// git appends a TAB after ---/+++ paths containing spaces or specials.
	let decoded = raw.replace(/\t$/, "");
	if (decoded.startsWith('"') && decoded.endsWith('"') && decoded.length >= 2) {
		decoded = decodeQuotedPath(decoded.slice(1, -1));
	}
	if (decoded === "/dev/null") return undefined;
	if (decoded.startsWith(prefix)) decoded = decoded.slice(prefix.length);
	return decoded;
}

function splitEqualGitHeader(firstLine: string): [string, string] | null {
	if (!firstLine.startsWith("diff --git a/")) return null;
	const rest = firstLine.slice("diff --git a/".length);
	if ((rest.length - 3) % 2 !== 0) return null;
	const half = (rest.length - 3) / 2;
	const candidate = rest.slice(0, half);
	if (rest.slice(half, half + 3) === " b/" && rest.slice(half + 3) === candidate) {
		return [candidate, candidate];
	}
	return null;
}

const RENAME_FROM_NAME_RE = /^(?:rename|copy) from (.+)$/m;
const RENAME_TO_NAME_RE = /^(?:rename|copy) to (.+)$/m;

function decodeRenameName(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
		return decodeQuotedPath(raw.slice(1, -1));
	}
	return raw;
}

function parseFileNames(segment: string): { prevName?: string; name?: string } {
	// rename/copy lines are authoritative and unambiguous — unlike the
	// `diff --git` header, whose unquoted form can't be split reliably when a
	// path itself contains " b/".
	const renameFrom = decodeRenameName(segment.match(RENAME_FROM_NAME_RE)?.[1]);
	const renameTo = decodeRenameName(segment.match(RENAME_TO_NAME_RE)?.[1]);
	if (renameFrom !== undefined && renameTo !== undefined) {
		return { prevName: renameFrom, name: renameTo };
	}
	const plusName = decodeHeaderName(segment.match(PLUS_NAME_RE)?.[1], "b/");
	const minusName = decodeHeaderName(segment.match(MINUS_NAME_RE)?.[1], "a/");
	const quotedGit = segment.match(DIFF_GIT_QUOTED_NAMES_RE);
	// Unquoted headers are ambiguous when the path contains " b/"; for
	// non-renames both halves are identical, so prefer the equal split.
	const firstLine = segment.slice(
		0,
		segment.indexOf("\n") === -1 ? undefined : segment.indexOf("\n"),
	);
	const equalHalves = quotedGit ? null : splitEqualGitHeader(firstLine);
	const gitMatch = quotedGit ?? segment.match(DIFF_GIT_NAMES_RE);
	const gitOld = quotedGit
		? decodeQuotedPath(gitMatch?.[1] ?? "")
		: (equalHalves?.[0] ?? gitMatch?.[1]);
	const gitNew = quotedGit
		? decodeQuotedPath(gitMatch?.[2] ?? "")
		: (equalHalves?.[1] ?? gitMatch?.[2]);
	const name = plusName ?? gitNew ?? undefined;
	const prevName = minusName ?? gitOld ?? undefined;
	return { prevName, name };
}

interface ParsedHunk {
	oldStart: number;
	oldLines: number;
	header: string;
	lines: string[];
}

function parseHunksFromSegment(segmentText: string): ParsedHunk[] {
	const lines = segmentText.split("\n");
	const hunks: ParsedHunk[] = [];
	let current: ParsedHunk | null = null;

	for (const line of lines) {
		const match = line.match(HUNK_HEADER_RE);
		if (match) {
			if (current) {
				while (current.lines.at(-1) === "") current.lines.pop();
				hunks.push(current);
			}
			const oldStart = match[1] === undefined ? 0 : Number.parseInt(match[1], 10);
			const oldLines = match[2] === undefined ? 1 : Number.parseInt(match[2], 10);
			current = { oldStart, oldLines, header: line, lines: [] };
			continue;
		}
		if (current) current.lines.push(line);
	}
	if (current) {
		while (current.lines.at(-1) === "") current.lines.pop();
		hunks.push(current);
	}

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
		if (allHunks.length === 0) {
			// Only the header-only sentinel selects a zero-hunk file; a ref with a
			// real oldStart that matches nothing is simply invalid and stays ignored.
			if (!chapterOldStarts.has(HEADER_ONLY_OLD_START)) continue;
			// Header-only files (binary contents, pure renames) have no hunks to
			// filter; include them whole — matched via the HEADER_ONLY_OLD_START
			// sentinel ref — so chapter views can render them through the
			// image/full-preview branches. Mirrors hosted's filterFilesForChapter,
			// which passes zero-hunk files straight through.
			const diff = parseSegment(segment.text);
			if (diff === null) continue;
			result.push({ file: fileDiffToPullRequestFile(diff), diff });
			continue;
		}

		const chapterHunks = allHunks.filter((h) => chapterOldStarts.has(h.oldStart));
		if (chapterHunks.length === 0) continue;

		const contents = fileContents?.[segment.name ?? filePath];
		// base64 entries are image bytes; applying text hunks to them would
		// corrupt the reconstruction, so enrichment only uses UTF-8 entries.
		if (
			contents?.encoding !== "base64" &&
			contents?.oldContent != null &&
			contents?.newContent != null
		) {
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
				...chapterHunks.flatMap((h) => [h.header, ...h.lines]),
			].join("\n");
			const diff = parseSegment(filteredText);
			if (diff === null) continue;
			result.push({ file: fileDiffToPullRequestFile(diff), diff });
		}
	}

	return result;
}

/**
 * Parse one file's patch text through Pierre, skipping segments its parser
 * rejects (e.g. C-quoted header paths from patches generated before the CLI
 * disabled core.quotepath) instead of crashing the whole chapter view.
 */
function parseSegment(text: string): FileDiffMetadata | null {
	try {
		return getSingularPatch(text);
	} catch {
		return null;
	}
}
