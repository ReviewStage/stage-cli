// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
	buildSelectedLineRange,
	getLineSide,
	normalizeSelectedLineRange,
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
