import type { Hunk } from "@stagereview/types/parsed-diff";
import { LINE_TYPE } from "@stagereview/types/parsed-diff";
import { describe, expect, it } from "vitest";
import { formatHunkDiffWithLineNumbers } from "../format-diff.js";

describe("formatHunkDiffWithLineNumbers", () => {
	it("renders the exact string the narrative model sees for a mixed hunk", () => {
		const hunk: Hunk = {
			header: "@@ -1,4 +1,5 @@",
			oldStart: 1,
			newStart: 1,
			oldLines: 4,
			newLines: 5,
			lines: [
				{
					type: LINE_TYPE.CONTEXT,
					content: "const x = 1;",
					oldLineNumber: 1,
					newLineNumber: 1,
				},
				{
					type: LINE_TYPE.DELETION,
					content: "const y = 2;",
					oldLineNumber: 2,
				},
				{
					type: LINE_TYPE.ADDITION,
					content: "const y = 20;",
					newLineNumber: 2,
				},
				{
					type: LINE_TYPE.ADDITION,
					content: "const z = 3;",
					newLineNumber: 3,
				},
				{
					type: LINE_TYPE.CONTEXT,
					content: "return x + y + z;",
					oldLineNumber: 3,
					newLineNumber: 4,
				},
				{
					type: LINE_TYPE.DELETION,
					content: "// unused",
					oldLineNumber: 4,
				},
				{
					type: LINE_TYPE.ADDITION,
					content: "// end",
					newLineNumber: 5,
				},
			],
		};

		expect(formatHunkDiffWithLineNumbers(hunk)).toBe(
			[
				"1 1 | const x = 1;",
				"2   |-const y = 2;",
				"  2 |+const y = 20;",
				"  3 |+const z = 3;",
				"3 4 | return x + y + z;",
				"4   |-// unused",
				"  5 |+// end",
			].join("\n"),
		);
	});

	it("pads single- and multi-digit line numbers to a shared column width", () => {
		const hunk: Hunk = {
			header: "@@ -9,2 +9,3 @@",
			oldStart: 9,
			newStart: 9,
			oldLines: 2,
			newLines: 3,
			lines: [
				{
					type: LINE_TYPE.CONTEXT,
					content: "a",
					oldLineNumber: 9,
					newLineNumber: 9,
				},
				{
					type: LINE_TYPE.ADDITION,
					content: "b",
					newLineNumber: 10,
				},
				{
					type: LINE_TYPE.CONTEXT,
					content: "c",
					oldLineNumber: 10,
					newLineNumber: 11,
				},
			],
		};

		expect(formatHunkDiffWithLineNumbers(hunk)).toBe(
			[" 9  9 | a", "   10 |+b", "10 11 | c"].join("\n"),
		);
	});

	it("uses blank padding when a hunk has no lines", () => {
		const hunk: Hunk = {
			header: "@@ -1,0 +1,0 @@",
			oldStart: 1,
			newStart: 1,
			oldLines: 0,
			newLines: 0,
			lines: [],
		};

		expect(formatHunkDiffWithLineNumbers(hunk)).toBe("");
	});
});
