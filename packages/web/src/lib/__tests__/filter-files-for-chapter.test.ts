import { HEADER_ONLY_OLD_START } from "@stagereview/types/chapters";
import { describe, expect, it } from "vitest";
import { FILE_STATUS } from "../diff-types";
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

	describe("header-only files (zero-hunk segments)", () => {
		const HEADER_ONLY_PATCH = `diff --git a/assets/logo.png b/assets/logo.png
index 1111111..2222222 100644
Binary files a/assets/logo.png and b/assets/logo.png differ
diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 100%
rename from src/old-name.ts
rename to src/new-name.ts
`;

		it("includes a binary file matched by a header-only sentinel ref", () => {
			const result = filterFilesForChapter(HEADER_ONLY_PATCH, [
				{ filePath: "assets/logo.png", oldStart: HEADER_ONLY_OLD_START },
			]);
			expect(result).toHaveLength(1);
			expect(result[0]?.file.path).toBe("assets/logo.png");
			expect(result[0]?.diff.hunks).toHaveLength(0);
		});

		it("includes a pure rename matched by a header-only sentinel ref", () => {
			const result = filterFilesForChapter(HEADER_ONLY_PATCH, [
				{ filePath: "src/new-name.ts", oldStart: HEADER_ONLY_OLD_START },
			]);
			expect(result).toHaveLength(1);
			expect(result[0]?.file.path).toBe("src/new-name.ts");
			expect(result[0]?.file.oldPath).toBe("src/old-name.ts");
			expect(result[0]?.file.status).toBe(FILE_STATUS.MOVED);
			expect(result[0]?.diff.hunks).toHaveLength(0);
		});

		it("includes header-only files even when file contents are provided", () => {
			const result = filterFilesForChapter(
				HEADER_ONLY_PATCH,
				[{ filePath: "src/new-name.ts", oldStart: HEADER_ONLY_OLD_START }],
				{ "src/new-name.ts": { oldContent: "same\n", newContent: "same\n" } },
			);
			expect(result).toHaveLength(1);
			expect(result[0]?.diff.hunks).toHaveLength(0);
		});
	});

	it("matches hunk refs against raw UTF-8 file names (quotepath=off output)", () => {
		const decodedPath = "src/ol\u00e9 file.ts";
		const patch = `diff --git a/${decodedPath} b/${decodedPath}
index 1111111..2222222 100644
--- a/${decodedPath}
+++ b/${decodedPath}
@@ -10,3 +10,3 @@
 line a
-line b
+line B
 line c
`;
		const entries = filterFilesForChapter(patch, [{ filePath: decodedPath, oldStart: 10 }]);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.file.path).toBe(decodedPath);
	});

	it("skips C-quoted segments (legacy patches) without crashing the chapter view", () => {
		const quoted = `diff --git "a/src/ol\\303\\251 file.ts" "b/src/ol\\303\\251 file.ts"
index 1111111..2222222 100644
--- "a/src/ol\\303\\251 file.ts"
+++ "b/src/ol\\303\\251 file.ts"
@@ -10,3 +10,3 @@
 line a
-line b
+line B
 line c
`;
		const patch = `${quoted}${TWO_FILE_PATCH}`;
		const decodedPath = "src/ol\u00e9 file.ts";
		const entries = filterFilesForChapter(patch, [
			{ filePath: decodedPath, oldStart: 10 },
			{ filePath: "src/foo.ts", oldStart: 10 },
		]);
		expect(entries.map((e) => e.file.path)).toEqual(["src/foo.ts"]);
	});

	it("uses rename lines to name segments when the git header is ambiguous", () => {
		const patch = `diff --git a/old b/name.png b/new b/name.png
similarity index 100%
rename from old b/name.png
rename to new b/name.png
`;
		const entries = filterFilesForChapter(patch, [{ filePath: "new b/name.png", oldStart: 0 }]);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.file.path).toBe("new b/name.png");
	});
});
