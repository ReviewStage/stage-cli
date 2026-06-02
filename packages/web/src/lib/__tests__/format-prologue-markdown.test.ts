import {
	COMPLEXITY_LEVEL,
	FOCUS_AREA_SEVERITY,
	FOCUS_AREA_TYPE,
	type Prologue,
} from "@stagereview/types/prologue";
import { describe, expect, it } from "vitest";
import { formatPrologueAsMarkdown } from "../format-prologue-markdown";

const basePrologue: Prologue = {
	motivation: "Reviews were hard to follow.",
	outcome: "Reviews read like a story now.",
	keyChanges: [
		{ summary: "Adds a sidebar", description: "Prologue and description tabs" },
		{ summary: "Reworks the list", description: "" },
	],
	focusAreas: [
		{
			type: FOCUS_AREA_TYPE.ARCHITECTURE,
			severity: FOCUS_AREA_SEVERITY.MEDIUM,
			title: "Dropped affordances",
			description: "Confirm nothing relies on them",
			locations: ["packages/web/src/routes/chapters-index-page.tsx"],
		},
		{
			type: FOCUS_AREA_TYPE.NEW_PATTERN,
			severity: FOCUS_AREA_SEVERITY.INFO,
			title: "Just an FYI",
			description: "Not a concern",
			locations: [],
		},
	],
	complexity: { level: COMPLEXITY_LEVEL.MEDIUM, reasoning: "UI restructure" },
};

describe("formatPrologueAsMarkdown", () => {
	it("renders motivation, outcome, key changes, review focus, and complexity", () => {
		const md = formatPrologueAsMarkdown(basePrologue);
		expect(md).toContain("# Prologue");
		expect(md).toContain("## Why this change?\nReviews were hard to follow.");
		expect(md).toContain("## What it does\nReviews read like a story now.");
		expect(md).toContain("- **Adds a sidebar**: Prologue and description tabs");
		expect(md).toContain("- **Reworks the list**");
		expect(md).toContain("## Complexity\n- **Level**: medium\n- **Reasoning**: UI restructure");
	});

	it("includes only non-info focus areas under Review Focus, with locations", () => {
		const md = formatPrologueAsMarkdown(basePrologue);
		expect(md).toContain(
			"- **Dropped affordances** (packages/web/src/routes/chapters-index-page.tsx): Confirm nothing relies on them",
		);
		expect(md).not.toContain("Just an FYI");
	});

	it("omits Why/What sections when motivation and outcome are null", () => {
		const md = formatPrologueAsMarkdown({ ...basePrologue, motivation: null, outcome: null });
		expect(md).not.toContain("## Why this change?");
		expect(md).not.toContain("## What it does");
	});
});
