import { describe, expect, it } from "vitest";
import { filterFilesForChapter } from "../filter-files-for-chapter";

const TWO_FILE_PATCH = `diff --git a/src/foo.ts b/src/foo.ts
index 1111111..2222222 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -10,3 +10,3 @@
 line a
-line b
+line B
 line c
@@ -50,3 +50,3 @@
 line x
-line y
+line Y
 line z
diff --git a/src/bar.ts b/src/bar.ts
index 3333333..4444444 100644
--- a/src/bar.ts
+++ b/src/bar.ts
@@ -1,3 +1,3 @@
 alpha
-beta
+BETA
 gamma
`;

describe("filterFilesForChapter", () => {
	it("returns no entries when hunkRefs is empty", () => {
		const result = filterFilesForChapter(TWO_FILE_PATCH, []);
		expect(result).toHaveLength(0);
	});

	it("filters to a single file's single hunk by oldStart", () => {
		const result = filterFilesForChapter(TWO_FILE_PATCH, [
			{ filePath: "src/foo.ts", oldStart: 10 },
		]);
		expect(result).toHaveLength(1);
		const entry = result[0];
		expect(entry?.file.path).toBe("src/foo.ts");
		expect(entry?.diff.hunks).toHaveLength(1);
		expect(entry?.diff.hunks[0]?.deletionStart).toBe(10);
	});

	it("preserves both hunks when both are referenced", () => {
		const result = filterFilesForChapter(TWO_FILE_PATCH, [
			{ filePath: "src/foo.ts", oldStart: 10 },
			{ filePath: "src/foo.ts", oldStart: 50 },
		]);
		expect(result).toHaveLength(1);
		expect(result[0]?.diff.hunks).toHaveLength(2);
		expect(result[0]?.diff.hunks.map((h) => h.deletionStart).sort()).toEqual([10, 50]);
	});

	it("returns multiple files in hunkRef first-appearance order", () => {
		const result = filterFilesForChapter(TWO_FILE_PATCH, [
			{ filePath: "src/bar.ts", oldStart: 1 },
			{ filePath: "src/foo.ts", oldStart: 10 },
		]);
		expect(result.map((e) => e.file.path)).toEqual(["src/bar.ts", "src/foo.ts"]);
	});

	it("ignores hunkRefs whose file is missing from the patch", () => {
		const result = filterFilesForChapter(TWO_FILE_PATCH, [
			{ filePath: "src/missing.ts", oldStart: 1 },
			{ filePath: "src/foo.ts", oldStart: 10 },
		]);
		expect(result).toHaveLength(1);
		expect(result[0]?.file.path).toBe("src/foo.ts");
	});

	it("ignores hunkRefs whose oldStart doesn't match any hunk", () => {
		const result = filterFilesForChapter(TWO_FILE_PATCH, [
			{ filePath: "src/foo.ts", oldStart: 999 },
		]);
		expect(result).toHaveLength(0);
	});

	it("returns no entries for an empty patch", () => {
		const result = filterFilesForChapter("", [{ filePath: "src/foo.ts", oldStart: 10 }]);
		expect(result).toHaveLength(0);
	});

	it("recomputes file additions and deletions from the filtered hunks", () => {
		const result = filterFilesForChapter(TWO_FILE_PATCH, [
			{ filePath: "src/foo.ts", oldStart: 10 },
		]);
		expect(result[0]?.file.additions).toBe(1);
		expect(result[0]?.file.deletions).toBe(1);
	});
});
