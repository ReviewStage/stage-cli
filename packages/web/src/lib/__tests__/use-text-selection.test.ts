import { describe, expect, it } from "vitest";
import { buildSelectedLineRange, normalizeSelectedLineRange } from "../use-text-selection";

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
