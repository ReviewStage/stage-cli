import { LINE_TYPE } from "@stagereview/types";
import { describe, expect, it } from "vitest";
import { COMMENT_SIDE } from "@/lib/diff-types";
import {
	buildReviewCommentPreviewPatch,
	canRenderReviewCommentPreviewWithPatchDiff,
	getReviewCommentDiffPreviewLines,
	getReviewCommentSelectedLines,
	isReviewCommentDiffLineHighlighted,
	parseReviewCommentDiffHunk,
} from "../review-comment-diff-hunk";

const DIFF_HUNK = [
	"@@ -8,5 +8,6 @@ function calculateTotal(items) {",
	" const subtotal = sum(items);",
	"-const discount = 0;",
	"+const discount = getDiscount(items);",
	"+const tax = calculateTax(subtotal);",
	" return subtotal - discount;",
].join("\n");

const OUTDATED_RIGHT_SIDE_HUNK = [
	"@@ -90,20 +90,24 @@ export class MySqlDialect {",
	" \t}",
	" ",
	" \tbuildUpdateSet(table: MySqlTable, set: UpdateSet): SQL {",
	"-\t\tconst setEntries = Object.entries(set);",
	"-",
	"-\t\tconst setSize = setEntries.length;",
	"-\t\treturn sql.join(",
	"-\t\t\tsetEntries",
	"-\t\t\t\t.flatMap(([colName, value], i): SQL[] => {",
	"-\t\t\t\t\tconst col: MySqlColumn = table[Table.Symbol.Columns][colName]!;",
	"-\t\t\t\t\tconst res = sql`identifier = value`;",
	"-\t\t\t\t\tif (i < setSize - 1) {",
	"-\t\t\t\t\t\treturn [res, sql.raw(', ')];",
	"-\t\t\t\t\t}",
	"-\t\t\t\t\treturn [res];",
	"-\t\t\t\t}),",
	"+\t\tconst tableColumns = table[Table.Symbol.Columns];",
	"+",
	"+\t\tconst columnNames = Object.keys(tableColumns).filter((colName) =>",
	"+\t\t\t!!set[colName] || tableColumns[colName]?.onUpdateFn !== undefined",
].join("\n");

const CONTEXTLESS_ADDITION_HUNK = [
	"@@ -40,0 +40,2 @@",
	"+const first = 1;",
	"+const second = 2;",
].join("\n");

const CONTEXTLESS_REPLACEMENT_HUNK = [
	"@@ -40 +40 @@",
	"-const value = oldValue;",
	"+const value = newValue;",
].join("\n");

describe("parseReviewCommentDiffHunk", () => {
	it("parses header context and old/new line numbers", () => {
		const hunk = parseReviewCommentDiffHunk(DIFF_HUNK);
		if (!hunk) throw new Error("Expected hunk to parse");

		expect(hunk.context).toBe("function calculateTotal(items) {");
		expect(hunk.lines).toEqual([
			{
				rowNumber: 1,
				type: LINE_TYPE.CONTEXT,
				content: "const subtotal = sum(items);",
				oldLineNumber: 8,
				newLineNumber: 8,
				isMetadata: false,
			},
			{
				rowNumber: 2,
				type: LINE_TYPE.DELETION,
				content: "const discount = 0;",
				oldLineNumber: 9,
				newLineNumber: null,
				isMetadata: false,
			},
			{
				rowNumber: 3,
				type: LINE_TYPE.ADDITION,
				content: "const discount = getDiscount(items);",
				oldLineNumber: null,
				newLineNumber: 9,
				isMetadata: false,
			},
			{
				rowNumber: 4,
				type: LINE_TYPE.ADDITION,
				content: "const tax = calculateTax(subtotal);",
				oldLineNumber: null,
				newLineNumber: 10,
				isMetadata: false,
			},
			{
				rowNumber: 5,
				type: LINE_TYPE.CONTEXT,
				content: "return subtotal - discount;",
				oldLineNumber: 10,
				newLineNumber: 11,
				isMetadata: false,
			},
		]);
	});

	it("returns null for malformed hunk headers", () => {
		expect(parseReviewCommentDiffHunk("not a diff hunk\n+const value = true;")).toBeNull();
	});
});

describe("isReviewCommentDiffLineHighlighted", () => {
	it("highlights the reviewed line on the right side", () => {
		const hunk = parseReviewCommentDiffHunk(DIFF_HUNK);
		if (!hunk) throw new Error("Expected hunk to parse");

		const highlighted = hunk.lines.filter((line) =>
			isReviewCommentDiffLineHighlighted(line, {
				side: COMMENT_SIDE.RIGHT,
				line: 10,
				startLine: null,
				startSide: null,
			}),
		);

		expect(highlighted.map((line) => line.content)).toEqual([
			"const tax = calculateTax(subtotal);",
		]);
	});

	it("highlights a reviewed deletion on the left side", () => {
		const hunk = parseReviewCommentDiffHunk(DIFF_HUNK);
		if (!hunk) throw new Error("Expected hunk to parse");

		const highlighted = hunk.lines.filter((line) =>
			isReviewCommentDiffLineHighlighted(line, {
				side: COMMENT_SIDE.LEFT,
				line: 9,
				startLine: null,
				startSide: null,
			}),
		);

		expect(highlighted.map((line) => line.content)).toEqual(["const discount = 0;"]);
	});

	it("highlights a multi-line range on the same side", () => {
		const hunk = parseReviewCommentDiffHunk(DIFF_HUNK);
		if (!hunk) throw new Error("Expected hunk to parse");

		const highlighted = hunk.lines.filter((line) =>
			isReviewCommentDiffLineHighlighted(line, {
				side: COMMENT_SIDE.RIGHT,
				line: 10,
				startLine: 8,
				startSide: COMMENT_SIDE.RIGHT,
			}),
		);

		expect(highlighted.map((line) => line.content)).toEqual([
			"const subtotal = sum(items);",
			"const discount = getDiscount(items);",
			"const tax = calculateTax(subtotal);",
		]);
	});
});

describe("getReviewCommentDiffPreviewLines", () => {
	it("returns the commented line with nearby context and excludes distant hunk lines", () => {
		const diffHunk = [
			"@@ -20,12 +20,12 @@ function render() {",
			" const first = 1;",
			" const second = 2;",
			" const third = 3;",
			" const fourth = 4;",
			"-const fifth = oldValue;",
			"+const fifth = newValue;",
			" const sixth = 6;",
			" const seventh = 7;",
			" const eighth = 8;",
			" const ninth = 9;",
			" const tenth = 10;",
			" const eleventh = 11;",
		].join("\n");
		const hunk = parseReviewCommentDiffHunk(diffHunk);
		if (!hunk) throw new Error("Expected hunk to parse");

		const lines = getReviewCommentDiffPreviewLines(
			hunk,
			{
				side: COMMENT_SIDE.RIGHT,
				line: 24,
				startLine: null,
				startSide: null,
			},
			{ contextLineCount: 2 },
		);

		expect(lines.map((line) => line.content)).toEqual([
			"const fourth = 4;",
			"const fifth = oldValue;",
			"const fifth = newValue;",
		]);
	});

	it("returns the whole commented range plus context for multi-line comments", () => {
		const hunk = parseReviewCommentDiffHunk(DIFF_HUNK);
		if (!hunk) throw new Error("Expected hunk to parse");

		const lines = getReviewCommentDiffPreviewLines(
			hunk,
			{
				side: COMMENT_SIDE.RIGHT,
				line: 10,
				startLine: 8,
				startSide: COMMENT_SIDE.RIGHT,
			},
			{ contextLineCount: 1 },
		);

		expect(lines.map((line) => line.content)).toEqual([
			"const subtotal = sum(items);",
			"const discount = 0;",
			"const discount = getDiscount(items);",
			"const tax = calculateTax(subtotal);",
		]);
	});

	it("returns no lines when the review comment has no concrete target line", () => {
		const hunk = parseReviewCommentDiffHunk(DIFF_HUNK);
		if (!hunk) throw new Error("Expected hunk to parse");

		expect(
			getReviewCommentDiffPreviewLines(hunk, {
				side: COMMENT_SIDE.RIGHT,
				line: null,
				startLine: null,
				startSide: null,
			}),
		).toEqual([]);
	});

	it("keeps only nearby rows for outdated comments on added lines", () => {
		const hunk = parseReviewCommentDiffHunk(OUTDATED_RIGHT_SIDE_HUNK);
		if (!hunk) throw new Error("Expected hunk to parse");

		const lines = getReviewCommentDiffPreviewLines(hunk, {
			side: COMMENT_SIDE.RIGHT,
			line: 96,
			startLine: null,
			startSide: null,
		});

		// The nearest context row is 15 rows above the window; pulling it in
		// non-contiguously would break the preview patch numbering, so the
		// preview stays one-sided.
		expect(lines.map((line) => line.content)).toEqual([
			"\t\tconst tableColumns = table[Table.Symbol.Columns];",
			"",
			"\t\tconst columnNames = Object.keys(tableColumns).filter((colName) =>",
			"\t\t\t!!set[colName] || tableColumns[colName]?.onUpdateFn !== undefined",
		]);
		expect(canRenderReviewCommentPreviewWithPatchDiff(lines)).toBe(false);
	});

	it("extends contiguously to a nearby context row instead of skipping rows", () => {
		const diffHunk = [
			"@@ -10,3 +10,8 @@ function render() {",
			" const base = 1;",
			"+const a = 2;",
			"+const b = 3;",
			"+const c = 4;",
			"+const d = 5;",
			"+const e = 6;",
		].join("\n");
		const hunk = parseReviewCommentDiffHunk(diffHunk);
		if (!hunk) throw new Error("Expected hunk to parse");

		const lines = getReviewCommentDiffPreviewLines(
			hunk,
			{
				side: COMMENT_SIDE.RIGHT,
				line: 15,
				startLine: null,
				startSide: null,
			},
			{ contextLineCount: 2 },
		);

		// Every row between the context anchor and the commented line is kept,
		// so line numbering in the generated patch matches the real hunk.
		expect(lines.map((line) => line.content)).toEqual([
			"const base = 1;",
			"const a = 2;",
			"const b = 3;",
			"const c = 4;",
			"const d = 5;",
			"const e = 6;",
		]);

		const patch = buildReviewCommentPreviewPatch("src/render.ts", hunk, lines);
		if (!patch) throw new Error("Expected patch to build");
		expect(patch.split("\n")).toEqual([
			"diff --git a/src/render.ts b/src/render.ts",
			"--- a/src/render.ts",
			"+++ b/src/render.ts",
			"@@ -10 +10,6 @@ function render() {",
			" const base = 1;",
			"+const a = 2;",
			"+const b = 3;",
			"+const c = 4;",
			"+const d = 5;",
			"+const e = 6;",
		]);
	});
});

describe("buildReviewCommentPreviewPatch", () => {
	it("builds a focused mini patch for Pierre PatchDiff", () => {
		const hunk = parseReviewCommentDiffHunk(DIFF_HUNK);
		if (!hunk) throw new Error("Expected hunk to parse");
		const lines = getReviewCommentDiffPreviewLines(
			hunk,
			{
				side: COMMENT_SIDE.RIGHT,
				line: 10,
				startLine: null,
				startSide: null,
			},
			{ contextLineCount: 1 },
		);

		const patch = buildReviewCommentPreviewPatch("src/billing.ts", hunk, lines);
		if (!patch) throw new Error("Expected patch to build");

		expect(patch.split("\n")).toEqual([
			"diff --git a/src/billing.ts b/src/billing.ts",
			"--- a/src/billing.ts",
			"+++ b/src/billing.ts",
			"@@ -8,2 +8,3 @@ function calculateTotal(items) {",
			" const subtotal = sum(items);",
			"-const discount = 0;",
			"+const discount = getDiscount(items);",
			"+const tax = calculateTax(subtotal);",
		]);
	});
});

describe("canRenderReviewCommentPreviewWithPatchDiff", () => {
	it("rejects one-sided contextless snippets that Pierre PatchDiff cannot render safely", () => {
		const hunk = parseReviewCommentDiffHunk(CONTEXTLESS_ADDITION_HUNK);
		if (!hunk) throw new Error("Expected hunk to parse");

		expect(canRenderReviewCommentPreviewWithPatchDiff(hunk.lines)).toBe(false);
	});

	it("allows contextless replacements because they include both old and new rows", () => {
		const hunk = parseReviewCommentDiffHunk(CONTEXTLESS_REPLACEMENT_HUNK);
		if (!hunk) throw new Error("Expected hunk to parse");

		expect(canRenderReviewCommentPreviewWithPatchDiff(hunk.lines)).toBe(true);
	});

	it("allows one-sided snippets when real context is present", () => {
		const hunk = parseReviewCommentDiffHunk(DIFF_HUNK);
		if (!hunk) throw new Error("Expected hunk to parse");
		const lines = getReviewCommentDiffPreviewLines(hunk, {
			side: COMMENT_SIDE.RIGHT,
			line: 10,
			startLine: null,
			startSide: null,
		});

		expect(canRenderReviewCommentPreviewWithPatchDiff(lines)).toBe(true);
	});
});

describe("getReviewCommentSelectedLines", () => {
	it("maps the commented range to Pierre selected lines from the preview rows", () => {
		const hunk = parseReviewCommentDiffHunk(DIFF_HUNK);
		if (!hunk) throw new Error("Expected hunk to parse");
		const target = {
			side: COMMENT_SIDE.RIGHT,
			line: 10,
			startLine: 8,
			startSide: COMMENT_SIDE.RIGHT,
		};
		const lines = getReviewCommentDiffPreviewLines(hunk, target);

		expect(getReviewCommentSelectedLines(lines, target)).toEqual({
			start: 8,
			side: "additions",
			end: 10,
			endSide: "additions",
		});
	});

	it("uses old line numbers on the deletions side", () => {
		const hunk = parseReviewCommentDiffHunk(DIFF_HUNK);
		if (!hunk) throw new Error("Expected hunk to parse");
		const target = {
			side: COMMENT_SIDE.LEFT,
			line: 9,
			startLine: null,
			startSide: null,
		};
		const lines = getReviewCommentDiffPreviewLines(hunk, target);

		expect(getReviewCommentSelectedLines(lines, target)).toEqual({
			start: 9,
			side: "deletions",
			end: 9,
			endSide: "deletions",
		});
	});

	it("spans sides for cross-side multi-line comments", () => {
		const hunk = parseReviewCommentDiffHunk(DIFF_HUNK);
		if (!hunk) throw new Error("Expected hunk to parse");
		const target = {
			side: COMMENT_SIDE.RIGHT,
			line: 10,
			startLine: 9,
			startSide: COMMENT_SIDE.LEFT,
		};
		const lines = getReviewCommentDiffPreviewLines(hunk, target);

		expect(getReviewCommentSelectedLines(lines, target)).toEqual({
			start: 9,
			side: "deletions",
			end: 10,
			endSide: "additions",
		});
	});

	it("never references lines outside the preview rows", () => {
		const hunk = parseReviewCommentDiffHunk(DIFF_HUNK);
		if (!hunk) throw new Error("Expected hunk to parse");
		// Multi-line range starting before the hunk: only the rows that exist in
		// the preview may be selected, otherwise Pierre throws "No valid rowRange".
		const target = {
			side: COMMENT_SIDE.RIGHT,
			line: 10,
			startLine: 2,
			startSide: COMMENT_SIDE.RIGHT,
		};
		const lines = getReviewCommentDiffPreviewLines(hunk, target);

		expect(getReviewCommentSelectedLines(lines, target)).toEqual({
			start: 8,
			side: "additions",
			end: 10,
			endSide: "additions",
		});
	});

	it("returns null when no preview row is highlighted", () => {
		const hunk = parseReviewCommentDiffHunk(DIFF_HUNK);
		if (!hunk) throw new Error("Expected hunk to parse");
		const target = {
			side: COMMENT_SIDE.RIGHT,
			line: null,
			startLine: null,
			startSide: null,
		};

		expect(getReviewCommentSelectedLines(hunk.lines, target)).toBeNull();
	});
});
