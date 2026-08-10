import type { SelectedLineRange } from "@pierre/diffs";
import { LINE_TYPE, type LineType } from "@stagereview/types";
import { COMMENT_SIDE, type CommentSide, DIFF_SIDE, type DiffSide } from "@/lib/diff-types";

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;
const DEFAULT_CONTEXT_LINE_COUNT = 3;
/**
 * How far beyond the normal preview window we extend to reach a context line.
 * Pierre PatchDiff needs at least one two-sided row to render a partial hunk,
 * and the extension must stay contiguous so patch line numbering stays true.
 */
const CONTEXT_ANCHOR_SEARCH_DISTANCE = 6;

export interface ParsedReviewCommentDiffLine {
	rowNumber: number;
	type: LineType;
	content: string;
	oldLineNumber: number | null;
	newLineNumber: number | null;
	isMetadata: boolean;
}

export interface ParsedReviewCommentDiffHunk {
	header: string;
	context: string;
	lines: ParsedReviewCommentDiffLine[];
}

export interface ReviewCommentDiffTarget {
	side: CommentSide;
	line: number | null;
	startLine: number | null;
	startSide: CommentSide | null;
}

export interface ReviewCommentDiffPreviewOptions {
	contextLineCount?: number;
}

function parseLineNumber(value: string): number | null {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed)) return null;
	return parsed;
}

function withoutTrailingSplitLine(lines: string[]): string[] {
	if (lines.length === 0) return lines;
	if (lines[lines.length - 1] === "") return lines.slice(0, -1);
	return lines;
}

function stripDiffPrefix(line: string): string {
	if (line.length === 0) return "";
	return line.slice(1);
}

export function parseReviewCommentDiffHunk(diffHunk: string): ParsedReviewCommentDiffHunk | null {
	const lines = withoutTrailingSplitLine(diffHunk.split("\n"));
	const header = lines[0];
	if (!header) return null;

	const match = header.match(HUNK_HEADER_PATTERN);
	if (!match) return null;

	const oldStartRaw = match[1];
	const newStartRaw = match[2];
	if (oldStartRaw === undefined || newStartRaw === undefined) return null;

	const oldStart = parseLineNumber(oldStartRaw);
	const newStart = parseLineNumber(newStartRaw);
	if (oldStart === null || newStart === null) return null;

	const contextRaw = match[3];
	const context = contextRaw === undefined ? "" : contextRaw.trim();
	const parsedLines: ParsedReviewCommentDiffLine[] = [];
	let oldLineNumber = oldStart;
	let newLineNumber = newStart;
	let rowNumber = 1;

	for (const line of lines.slice(1)) {
		if (line.startsWith("\\")) {
			parsedLines.push({
				rowNumber,
				type: LINE_TYPE.HEADER,
				content: line,
				oldLineNumber: null,
				newLineNumber: null,
				isMetadata: true,
			});
			rowNumber += 1;
			continue;
		}

		if (line.startsWith("+")) {
			parsedLines.push({
				rowNumber,
				type: LINE_TYPE.ADDITION,
				content: stripDiffPrefix(line),
				oldLineNumber: null,
				newLineNumber,
				isMetadata: false,
			});
			newLineNumber += 1;
			rowNumber += 1;
			continue;
		}

		if (line.startsWith("-")) {
			parsedLines.push({
				rowNumber,
				type: LINE_TYPE.DELETION,
				content: stripDiffPrefix(line),
				oldLineNumber,
				newLineNumber: null,
				isMetadata: false,
			});
			oldLineNumber += 1;
			rowNumber += 1;
			continue;
		}

		const content = line.startsWith(" ") ? stripDiffPrefix(line) : line;
		parsedLines.push({
			rowNumber,
			type: LINE_TYPE.CONTEXT,
			content,
			oldLineNumber,
			newLineNumber,
			isMetadata: false,
		});
		oldLineNumber += 1;
		newLineNumber += 1;
		rowNumber += 1;
	}

	return {
		header,
		context,
		lines: parsedLines,
	};
}

function isLineWithinTargetRange(
	lineNumber: number | null,
	target: ReviewCommentDiffTarget,
): boolean {
	if (lineNumber === null || target.line === null) return false;
	const startsOnTargetSide = target.startSide === null || target.startSide === target.side;
	if (target.startLine === null || !startsOnTargetSide) return lineNumber === target.line;

	const start = Math.min(target.startLine, target.line);
	const end = Math.max(target.startLine, target.line);
	return lineNumber >= start && lineNumber <= end;
}

export function isReviewCommentDiffLineHighlighted(
	line: ParsedReviewCommentDiffLine,
	target: ReviewCommentDiffTarget,
): boolean {
	if (target.startLine !== null && target.startSide !== null && target.startSide !== target.side) {
		return (
			isLineWithinTargetRange(line.oldLineNumber, {
				side: COMMENT_SIDE.LEFT,
				line: target.startSide === COMMENT_SIDE.LEFT ? target.startLine : target.line,
				startLine: null,
				startSide: null,
			}) ||
			isLineWithinTargetRange(line.newLineNumber, {
				side: COMMENT_SIDE.RIGHT,
				line: target.startSide === COMMENT_SIDE.RIGHT ? target.startLine : target.line,
				startLine: null,
				startSide: null,
			})
		);
	}

	if (target.side === COMMENT_SIDE.LEFT) {
		return isLineWithinTargetRange(line.oldLineNumber, target);
	}
	return isLineWithinTargetRange(line.newLineNumber, target);
}

function findNearbyContextIndex(
	lines: ParsedReviewCommentDiffLine[],
	fromIndex: number,
	direction: -1 | 1,
): number | null {
	for (let distance = 1; distance <= CONTEXT_ANCHOR_SEARCH_DISTANCE; distance++) {
		const index = fromIndex + direction * distance;
		if (index < 0 || index >= lines.length) return null;
		if (lines[index]?.type === LINE_TYPE.CONTEXT) return index;
	}
	return null;
}

/**
 * Returns a contiguous slice of the hunk around the commented range.
 * Contiguity is a hard requirement: the preview patch header is derived from
 * the first line numbers of the slice, and Pierre renumbers rows sequentially
 * from there — a gap would shift every rendered line number after it and break
 * line selection.
 */
export function getReviewCommentDiffPreviewLines(
	hunk: ParsedReviewCommentDiffHunk,
	target: ReviewCommentDiffTarget,
	options: ReviewCommentDiffPreviewOptions = {},
): ParsedReviewCommentDiffLine[] {
	const contextLineCount =
		options.contextLineCount === undefined ? DEFAULT_CONTEXT_LINE_COUNT : options.contextLineCount;
	const highlightedIndexes: number[] = [];

	for (let index = 0; index < hunk.lines.length; index++) {
		const line = hunk.lines[index];
		if (!line || line.isMetadata) continue;
		if (isReviewCommentDiffLineHighlighted(line, target)) {
			highlightedIndexes.push(index);
		}
	}

	const firstHighlightedIndex = highlightedIndexes[0];
	const lastHighlightedIndex = highlightedIndexes[highlightedIndexes.length - 1];
	if (firstHighlightedIndex === undefined || lastHighlightedIndex === undefined) return [];

	let startIndex = Math.max(0, firstHighlightedIndex - contextLineCount);
	let endIndex = lastHighlightedIndex;
	const hasContext = hunk.lines
		.slice(startIndex, endIndex + 1)
		.some((line) => line.type === LINE_TYPE.CONTEXT);
	if (!hasContext) {
		const contextAbove = findNearbyContextIndex(hunk.lines, startIndex, -1);
		if (contextAbove !== null) {
			startIndex = contextAbove;
		} else {
			const contextBelow = findNearbyContextIndex(hunk.lines, endIndex, 1);
			if (contextBelow !== null) endIndex = contextBelow;
		}
	}
	return hunk.lines.slice(startIndex, endIndex + 1);
}

function formatHunkRange(startLine: number, lineCount: number): string {
	return lineCount === 1 ? String(startLine) : `${startLine},${lineCount}`;
}

function toPatchLine(line: ParsedReviewCommentDiffLine): string {
	if (line.type === LINE_TYPE.ADDITION) return `+${line.content}`;
	if (line.type === LINE_TYPE.DELETION) return `-${line.content}`;
	return ` ${line.content}`;
}

function getFirstLineNumberOrNull(
	lines: ParsedReviewCommentDiffLine[],
	key: "oldLineNumber" | "newLineNumber",
): number | null {
	for (const line of lines) {
		const lineNumber = line[key];
		if (lineNumber !== null) return lineNumber;
	}
	return null;
}

function getFirstLineNumber(
	lines: ParsedReviewCommentDiffLine[],
	key: "oldLineNumber" | "newLineNumber",
): number {
	const explicitLineNumber = getFirstLineNumberOrNull(lines, key);
	if (explicitLineNumber !== null) return explicitLineNumber;

	const fallbackKey = key === "oldLineNumber" ? "newLineNumber" : "oldLineNumber";
	const fallbackLineNumber = getFirstLineNumberOrNull(lines, fallbackKey);
	if (fallbackLineNumber !== null) return fallbackLineNumber;
	return 1;
}

export function buildReviewCommentPreviewPatch(
	filePath: string,
	hunk: ParsedReviewCommentDiffHunk,
	lines: ParsedReviewCommentDiffLine[],
): string | null {
	const renderableLines = lines.filter((line) => !line.isMetadata);
	if (renderableLines.length === 0) return null;

	const deletionStart = getFirstLineNumber(renderableLines, "oldLineNumber");
	const additionStart = getFirstLineNumber(renderableLines, "newLineNumber");
	const deletionCount = renderableLines.filter((line) => line.type !== LINE_TYPE.ADDITION).length;
	const additionCount = renderableLines.filter((line) => line.type !== LINE_TYPE.DELETION).length;
	const hunkContext = hunk.context ? ` ${hunk.context}` : "";
	const patchLines = renderableLines.map(toPatchLine);

	return [
		`diff --git a/${filePath} b/${filePath}`,
		`--- a/${filePath}`,
		`+++ b/${filePath}`,
		`@@ -${formatHunkRange(deletionStart, deletionCount)} +${formatHunkRange(
			additionStart,
			additionCount,
		)} @@${hunkContext}`,
		...patchLines,
	].join("\n");
}

export function canRenderReviewCommentPreviewWithPatchDiff(
	lines: ParsedReviewCommentDiffLine[],
): boolean {
	const renderableLines = lines.filter((line) => !line.isMetadata);
	const hasContext = renderableLines.some((line) => line.type === LINE_TYPE.CONTEXT);
	if (hasContext) return true;

	const hasOldSideLine = renderableLines.some((line) => line.oldLineNumber !== null);
	const hasNewSideLine = renderableLines.some((line) => line.newLineNumber !== null);
	return hasOldSideLine && hasNewSideLine;
}

interface SelectionPoint {
	line: number;
	side: DiffSide;
}

/**
 * Maps a preview row to the (line, side) pair Pierre renders it under in a
 * unified diff: deletions carry old numbers, additions and context carry new
 * numbers.
 */
function toSelectionPoint(line: ParsedReviewCommentDiffLine): SelectionPoint | null {
	if (line.type === LINE_TYPE.DELETION) {
		return line.oldLineNumber === null
			? null
			: { line: line.oldLineNumber, side: DIFF_SIDE.DELETIONS };
	}
	return line.newLineNumber === null
		? null
		: { line: line.newLineNumber, side: DIFF_SIDE.ADDITIONS };
}

/**
 * Derives the highlighted range from the rows actually present in the preview
 * rather than the raw comment coordinates. Pierre throws when a selection
 * references a line number it did not render, so the selection must be built
 * from the rendered rows.
 */
export function getReviewCommentSelectedLines(
	previewLines: ParsedReviewCommentDiffLine[],
	target: ReviewCommentDiffTarget,
): SelectedLineRange | null {
	const highlighted = previewLines.filter(
		(line) => !line.isMetadata && isReviewCommentDiffLineHighlighted(line, target),
	);
	const first = highlighted[0];
	const last = highlighted[highlighted.length - 1];
	if (first === undefined || last === undefined) return null;

	const start = toSelectionPoint(first);
	const end = toSelectionPoint(last);
	if (start === null || end === null) return null;

	return {
		start: start.line,
		side: start.side,
		end: end.line,
		endSide: end.side,
	};
}
