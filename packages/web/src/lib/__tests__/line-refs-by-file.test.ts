import { describe, expect, it } from "vitest";
import { DIFF_SIDE } from "../diff-types";
import { groupAnnotatedLineRefsByFile, groupLineRefsByFile } from "../line-refs-by-file";

describe("groupLineRefsByFile", () => {
	it("returns null for empty input", () => {
		expect(groupLineRefsByFile([])).toBeNull();
		expect(groupLineRefsByFile(null)).toBeNull();
		expect(groupLineRefsByFile(undefined)).toBeNull();
	});

	it("groups refs by filePath, preserving input order within a file", () => {
		const refs = [
			{ filePath: "a.ts", side: DIFF_SIDE.ADDITIONS, startLine: 1, endLine: 1 },
			{ filePath: "b.ts", side: DIFF_SIDE.ADDITIONS, startLine: 2, endLine: 2 },
			{ filePath: "a.ts", side: DIFF_SIDE.ADDITIONS, startLine: 5, endLine: 6 },
		];
		const result = groupLineRefsByFile(refs);
		expect(result?.get("a.ts")).toHaveLength(2);
		expect(result?.get("a.ts")?.[0]?.startLine).toBe(1);
		expect(result?.get("a.ts")?.[1]?.startLine).toBe(5);
		expect(result?.get("b.ts")).toHaveLength(1);
	});
});

describe("groupAnnotatedLineRefsByFile", () => {
	it("annotates each line ref with the keyChange's externalId, not the internal id", () => {
		// Regression: previously this used `keyChange.id` (internal DB id), which
		// caused overlay clicks to set focus to a value that never matched the
		// side-panel's externalId-keyed focus state.
		const result = groupAnnotatedLineRefsByFile([
			{
				externalId: "ext-kc-1",
				lineRefs: [
					{ filePath: "src/foo.ts", side: DIFF_SIDE.ADDITIONS, startLine: 10, endLine: 10 },
				],
			},
		]);
		expect(result?.get("src/foo.ts")?.[0]?.keyChangeId).toBe("ext-kc-1");
	});

	it("returns null when there are no key changes", () => {
		expect(groupAnnotatedLineRefsByFile([])).toBeNull();
		expect(groupAnnotatedLineRefsByFile(null)).toBeNull();
	});
});
