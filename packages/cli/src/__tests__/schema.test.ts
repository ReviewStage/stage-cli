import { describe, expect, it } from "vitest";
import { ChaptersFileSchema } from "../schema.js";

const SHA = {
	base: "1111111111111111111111111111111111111111",
	head: "2222222222222222222222222222222222222222",
	mergeBase: "3333333333333333333333333333333333333333",
} as const;

function makeLineRef(over: Record<string, unknown> = {}) {
	return {
		filePath: "src/foo.ts",
		side: "additions",
		startLine: 5,
		endLine: 10,
		...over,
	};
}

function makeHunkRef(over: Record<string, unknown> = {}) {
	return { filePath: "src/foo.ts", oldStart: 1, ...over };
}

function makeKeyChange(over: Record<string, unknown> = {}) {
	return {
		content: "Should orgId fall back to the user's primary org when not provided?",
		lineRefs: [makeLineRef()],
		...over,
	};
}

function makeChapter(over: Record<string, unknown> = {}) {
	return {
		id: "chapter-0",
		order: 1,
		title: "Wire org ID through the API layer",
		summary: "Threads orgId through request handlers so tenant queries scope correctly.",
		hunkRefs: [makeHunkRef()],
		keyChanges: [makeKeyChange()],
		...over,
	};
}

function makeCommittedScope(over: Record<string, unknown> = {}) {
	return {
		kind: "committed",
		baseSha: SHA.base,
		headSha: SHA.head,
		mergeBaseSha: SHA.mergeBase,
		...over,
	};
}

function makeWorkingTreeScope(over: Record<string, unknown> = {}) {
	return {
		kind: "workingTree",
		ref: "work",
		baseSha: SHA.base,
		headSha: SHA.head,
		mergeBaseSha: SHA.mergeBase,
		...over,
	};
}

function makeFixture(over: Record<string, unknown> = {}) {
	return {
		scope: makeCommittedScope(),
		chapters: [makeChapter()],
		generatedAt: "2026-04-26T12:00:00.000Z",
		...over,
	};
}

function expectInvalidAt(input: unknown, path: string) {
	const result = ChaptersFileSchema.safeParse(input);

	expect(result.success).toBe(false);
	if (!result.success) {
		expect(result.error.issues.map((issue) => issue.path.join("."))).toContain(path);
	}
}

describe("ChaptersFileSchema", () => {
	it("accepts the committed-scope chapters contract", () => {
		const result = ChaptersFileSchema.parse(makeFixture());

		expect(result.scope.kind).toBe("committed");
		expect(result.scope.mergeBaseSha).toBe(SHA.mergeBase);
		expect(result.chapters[0]?.keyChanges[0]?.lineRefs[0]?.side).toBe("additions");
	});

	it.each([
		"work",
		"staged",
		"unstaged",
	] as const)("accepts workingTree scope for %s changes", (ref) => {
		const result = ChaptersFileSchema.parse(makeFixture({ scope: makeWorkingTreeScope({ ref }) }));

		expect(result.scope.kind).toBe("workingTree");
		if (result.scope.kind === "workingTree") {
			expect(result.scope.ref).toBe(ref);
		}
	});

	it("allows empty chapter lists and chapters without anchored hunks", () => {
		expect(() => ChaptersFileSchema.parse(makeFixture({ chapters: [] }))).not.toThrow();
		expect(() =>
			ChaptersFileSchema.parse(
				makeFixture({ chapters: [makeChapter({ hunkRefs: [], keyChanges: [] })] }),
			),
		).not.toThrow();
	});

	it("rejects stored diff payloads", () => {
		expectInvalidAt({ ...makeFixture(), diff: "diff --git ..." }, "");
		expectInvalidAt(
			makeFixture({ scope: { ...makeCommittedScope(), diff: "diff --git ..." } }),
			"scope",
		);
		expectInvalidAt(
			makeFixture({ scope: { ...makeWorkingTreeScope(), diff: "diff --git ..." } }),
			"scope",
		);
	});

	it("rejects non-canonical scope references", () => {
		expectInvalidAt(
			makeFixture({ scope: makeCommittedScope({ headSha: "HEAD" }) }),
			"scope.headSha",
		);
		expectInvalidAt(
			makeFixture({ scope: makeCommittedScope({ headSha: SHA.head.slice(0, 7) }) }),
			"scope.headSha",
		);
		expectInvalidAt(
			makeFixture({
				scope: makeCommittedScope({
					headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".toUpperCase(),
				}),
			}),
			"scope.headSha",
		);
		expectInvalidAt(makeFixture({ scope: makeWorkingTreeScope({ ref: "tracked" }) }), "scope.ref");
	});

	it("rejects unparseable generatedAt timestamps", () => {
		expectInvalidAt(makeFixture({ generatedAt: "yesterday" }), "generatedAt");
	});

	it("accepts a file with a valid prologue", () => {
		const prologue = {
			motivation: "Users couldn't reset their password without getting logged out.",
			outcome: "Password reset now preserves the session.",
			keyChanges: [
				{
					summary: "Session token survives password reset",
					description: "Token refresh logic moved earlier in the reset flow",
				},
			],
			focusAreas: [
				{
					type: "security",
					severity: "high",
					title: "Session token handling",
					description:
						"Session persists across password change — confirm token rotation still occurs",
					locations: ["src/auth/reset.ts"],
				},
			],
			complexity: { level: "medium", reasoning: "Touches auth and session layers" },
		};
		const result = ChaptersFileSchema.parse(makeFixture({ prologue }));
		expect(result.prologue).toBeDefined();
		expect(result.prologue?.motivation).toBe(prologue.motivation);
	});

	it("defaults the prologue diagram to null when omitted", () => {
		const prologue = {
			motivation: null,
			outcome: null,
			keyChanges: [{ summary: "Tightens validation", description: "Rejects malformed input" }],
			focusAreas: [
				{
					type: "data-integrity",
					severity: "info",
					title: "Input validation",
					description: "Confirm the new constraints match the data model",
					locations: ["src/schema.ts"],
				},
			],
			complexity: { level: "low", reasoning: "Schema-only change" },
		};
		const result = ChaptersFileSchema.parse(makeFixture({ prologue }));
		expect(result.prologue?.diagram).toBeNull();
	});

	it("preserves a Mermaid diagram on the prologue", () => {
		const prologue = {
			motivation: null,
			outcome: null,
			diagram: "graph TD;\n  A-->B",
			keyChanges: [{ summary: "Adds a pipeline", description: "Wires producers to consumers" }],
			focusAreas: [
				{
					type: "architecture",
					severity: "info",
					title: "New data flow",
					description: "Confirm the pipeline ordering is correct",
					locations: ["src/pipeline.ts"],
				},
			],
			complexity: { level: "medium", reasoning: "New control flow across modules" },
		};
		const result = ChaptersFileSchema.parse(makeFixture({ prologue }));
		expect(result.prologue?.diagram).toBe(prologue.diagram);
	});

	it("rejects a non-string prologue diagram", () => {
		const prologue = {
			motivation: null,
			outcome: null,
			diagram: 42,
			keyChanges: [{ summary: "x", description: "y" }],
			focusAreas: [
				{ type: "architecture", severity: "info", title: "t", description: "d", locations: [] },
			],
			complexity: { level: "low", reasoning: "r" },
		};
		expectInvalidAt(makeFixture({ prologue }), "prologue.diagram");
	});

	it("accepts a file without a prologue (backward compatibility)", () => {
		const result = ChaptersFileSchema.parse(makeFixture());
		expect(result.prologue).toBeUndefined();
	});

	it("rejects a file with a malformed prologue", () => {
		expectInvalidAt(makeFixture({ prologue: { motivation: "test" } }), "prologue.keyChanges");
	});

	it("rejects line references the UI cannot anchor safely", () => {
		expectInvalidAt(
			makeFixture({
				chapters: [
					makeChapter({
						keyChanges: [
							makeKeyChange({ lineRefs: [makeLineRef({ startLine: 100, endLine: 5 })] }),
						],
					}),
				],
			}),
			"chapters.0.keyChanges.0.lineRefs.0.endLine",
		);
		expectInvalidAt(
			makeFixture({
				chapters: [makeChapter({ keyChanges: [makeKeyChange({ lineRefs: [] })] })],
			}),
			"chapters.0.keyChanges.0.lineRefs",
		);
	});
});
