import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	combineInstructions,
	formatInstructionsBlock,
	loadStageInstructions,
} from "../instructions.js";

describe("combineInstructions", () => {
	it("returns null when neither is present", () => {
		expect(combineInstructions(null, null)).toBeNull();
		expect(combineInstructions(undefined, undefined)).toBeNull();
		expect(combineInstructions("   ", "\n")).toBeNull();
	});

	it("returns the only present value, trimmed", () => {
		expect(combineInstructions("  use British spelling  ", null)).toBe("use British spelling");
		expect(combineInstructions(null, "  split tests out  ")).toBe("split tests out");
	});

	it("orders repo instructions before the per-run instruction", () => {
		expect(combineInstructions("repo rules", "this run only")).toBe("repo rules\n\nthis run only");
	});

	it("drops blank parts when combining", () => {
		expect(combineInstructions("repo rules", "   ")).toBe("repo rules");
		expect(combineInstructions("   ", "run ask")).toBe("run ask");
	});
});

describe("formatInstructionsBlock", () => {
	it("returns an empty string when there are no instructions", () => {
		expect(formatInstructionsBlock(null)).toBe("");
		expect(formatInstructionsBlock(undefined)).toBe("");
		expect(formatInstructionsBlock("   \n  ")).toBe("");
	});

	it("renders a labeled, trimmed block when instructions are present", () => {
		expect(formatInstructionsBlock("  Group test changes separately.  ")).toBe(
			"\n\nADDITIONAL INSTRUCTIONS:\nGroup test changes separately.",
		);
	});
});

describe("loadStageInstructions", () => {
	function makeTempDir(): string {
		return mkdtempSync(path.join(tmpdir(), "stage-test-"));
	}

	it("returns null when .stageinstructions does not exist", () => {
		expect(loadStageInstructions(makeTempDir())).toBeNull();
	});

	it("returns the file contents when present", () => {
		const dir = makeTempDir();
		writeFileSync(path.join(dir, ".stageinstructions"), "Group test changes separately.\n");
		expect(loadStageInstructions(dir)).toBe("Group test changes separately.\n");
	});
});
