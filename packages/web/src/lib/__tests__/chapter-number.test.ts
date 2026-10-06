import { describe, expect, it } from "vitest";
import { clampChapterNumber, parseChapterNumber } from "../chapter-number";

describe("parseChapterNumber", () => {
	it.each([
		["3", 3],
		["1e2", 1],
		["1.5", 1],
		["0", null],
		["-1", null],
		["abc", null],
	])("parses %s as %s", (value, expected) => {
		expect(parseChapterNumber(value)).toBe(expected);
	});
});

describe("clampChapterNumber", () => {
	it.each([
		[2, 3, 2],
		[999, 3, 3],
		[0, 3, 1],
		[4, 0, 1],
	])("clamps %s into %s chapters as %s", (chapterNumber, chapterCount, expected) => {
		expect(clampChapterNumber(chapterNumber, chapterCount)).toBe(expected);
	});
});
