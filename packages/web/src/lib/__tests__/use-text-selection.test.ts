// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
	buildSelectedLineRange,
	getLineSide,
	normalizeSelectedLineRange,
	previousRenderedLine,
	toSingleSideSelection,
} from "../use-text-selection";

describe("buildSelectedLineRange", () => {
	it("orders endpoints ascending and keeps the side", () => {
		expect(
			buildSelectedLineRange({
				startLine: 10,
				endLine: 5,
				startSide: "additions",
				endSide: "additions",
			}),
		).toEqual({ start: 5, side: "additions", end: 10, endSide: "additions" });
	});

	it("returns null for a selection spanning both diff sides", () => {
		expect(
			buildSelectedLineRange({
				startLine: 1,
				endLine: 3,
				startSide: "deletions",
				endSide: "additions",
			}),
		).toBeNull();
	});
});

describe("normalizeSelectedLineRange", () => {
	it("leaves an already-ascending range unchanged", () => {
		const range = { start: 2, side: "additions", end: 6, endSide: "additions" } as const;
		expect(normalizeSelectedLineRange(range)).toEqual(range);
	});

	it("swaps endpoints and sides when start > end (drag upward)", () => {
		expect(
			normalizeSelectedLineRange({ start: 9, side: "additions", end: 4, endSide: "deletions" }),
		).toEqual({ start: 4, side: "deletions", end: 9, endSide: "additions" });
	});
});

describe("toSingleSideSelection", () => {
	it("returns single-side draft endpoints for a same-side range", () => {
		expect(
			toSingleSideSelection({ start: 4, side: "additions", end: 9, endSide: "additions" }),
		).toEqual({ side: "additions", startLine: 4, endLine: 9 });
	});

	it("orders endpoints when dragging upward", () => {
		expect(
			toSingleSideSelection({ start: 9, side: "deletions", end: 4, endSide: "deletions" }),
		).toEqual({ side: "deletions", startLine: 4, endLine: 9 });
	});

	it("returns null for a cross-side gutter drag", () => {
		expect(
			toSingleSideSelection({ start: 1, side: "deletions", end: 3, endSide: "additions" }),
		).toBeNull();
		// An upward drag whose swap still leaves the sides mismatched is also cross-side.
		expect(
			toSingleSideSelection({ start: 9, side: "additions", end: 4, endSide: "deletions" }),
		).toBeNull();
	});

	it("falls back to endSide when only it is present, before defaulting to additions", () => {
		expect(toSingleSideSelection({ start: 2, end: 4, endSide: "deletions" })).toEqual({
			side: "deletions",
			startLine: 2,
			endLine: 4,
		});
	});

	it("defaults to the addition side when Pierre omits both sides", () => {
		expect(toSingleSideSelection({ start: 2, end: 4 })).toEqual({
			side: "additions",
			startLine: 2,
			endLine: 4,
		});
	});
});

describe("getLineSide", () => {
	function splitLine(sideAttr: "data-additions" | "data-deletions"): HTMLElement {
		const wrapper = document.createElement("div");
		wrapper.setAttribute(sideAttr, "");
		const line = document.createElement("div");
		line.setAttribute("data-line", "5");
		wrapper.appendChild(line);
		return line;
	}

	function unifiedLine(lineType: string): HTMLElement {
		const line = document.createElement("div");
		line.setAttribute("data-line", "5");
		line.setAttribute("data-line-type", lineType);
		return line;
	}

	it("reads the side from the split-view column ancestor", () => {
		expect(getLineSide(splitLine("data-deletions"))).toBe("deletions");
		expect(getLineSide(splitLine("data-additions"))).toBe("additions");
	});

	it("treats a unified change-deletion row as the deletion side", () => {
		expect(getLineSide(unifiedLine("change-deletion"))).toBe("deletions");
	});

	it("treats unified change-addition and context rows as the addition side", () => {
		expect(getLineSide(unifiedLine("change-addition"))).toBe("additions");
		expect(getLineSide(unifiedLine("context"))).toBe("additions");
	});
});

describe("previousRenderedLine", () => {
	function appendLine(scope: HTMLElement, line: number): HTMLElement {
		const el = document.createElement("div");
		el.setAttribute("data-line", String(line));
		scope.appendChild(el);
		return el;
	}

	it("returns the DOM-previous rendered line across a collapsed gap, not lineNumber - 1", () => {
		const scope = document.createElement("div");
		const before = appendLine(scope, 50);
		const after = appendLine(scope, 200); // lines 51–199 are collapsed: no DOM rows
		expect(previousRenderedLine(scope, after)).toBe(before);
	});

	it("returns null for the first rendered line", () => {
		const scope = document.createElement("div");
		const first = appendLine(scope, 50);
		expect(previousRenderedLine(scope, first)).toBeNull();
	});
});
