import { describe, expect, it } from "vitest";
import { calculateDiffStats, parseGitDiff } from "../diff-parser.js";

const ADDED_FILE_DIFF = `diff --git a/src/utils.ts b/src/utils.ts
new file mode 100644
index 0000000..abcdef1
--- /dev/null
+++ b/src/utils.ts
@@ -0,0 +1,3 @@
+export function hello() {
+	return "world";
+}`;

const DELETED_FILE_DIFF = `diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index abcdef1..0000000
--- a/src/old.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export function goodbye() {
-	return "world";
-}`;

const MOVED_FILE_DIFF = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 100%
rename from src/old-name.ts
rename to src/new-name.ts`;

const RENAMED_FILE_DIFF = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 85%
rename from src/old-name.ts
rename to src/new-name.ts
index abc123..def456 100644
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -1,3 +1,4 @@
 export function hello() {
-	return "world";
+	return "universe";
+	// updated
 }`;

const MODIFIED_FILE_DIFF = `diff --git a/src/app.ts b/src/app.ts
index abc123..def456 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,5 +1,6 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 const d = 5;`;

const MULTI_FILE_DIFF = `${ADDED_FILE_DIFF}
${MODIFIED_FILE_DIFF}`;

describe("parseGitDiff", () => {
	it("returns empty array for empty string", () => {
		expect(parseGitDiff("")).toEqual([]);
	});

	it("returns empty array for whitespace-only string", () => {
		expect(parseGitDiff("   \n\t  ")).toEqual([]);
	});

	it("parses an added file", () => {
		const result = parseGitDiff(ADDED_FILE_DIFF);
		expect(result).toHaveLength(1);
		expect(result[0]?.status).toBe("added");
		expect(result[0]?.path).toBe("src/utils.ts");
		expect(result[0]?.filename).toBe("utils.ts");
		expect(result[0]?.additions).toBe(3);
		expect(result[0]?.deletions).toBe(0);
		expect(result[0]?.hunks).toHaveLength(1);
	});

	it("parses a deleted file with correct path from 'from' field", () => {
		const result = parseGitDiff(DELETED_FILE_DIFF);
		expect(result).toHaveLength(1);
		expect(result[0]?.status).toBe("deleted");
		expect(result[0]?.path).toBe("src/old.ts");
		expect(result[0]?.filename).toBe("old.ts");
		expect(result[0]?.deletions).toBe(3);
	});

	it("parses a moved file (path changed, no content changes)", () => {
		const result = parseGitDiff(MOVED_FILE_DIFF);
		expect(result).toHaveLength(1);
		expect(result[0]?.status).toBe("moved");
		expect(result[0]?.path).toBe("src/new-name.ts");
		expect(result[0]?.oldPath).toBe("src/old-name.ts");
	});

	it("parses a renamed file (path changed with content changes)", () => {
		const result = parseGitDiff(RENAMED_FILE_DIFF);
		expect(result).toHaveLength(1);
		expect(result[0]?.status).toBe("renamed");
		expect(result[0]?.path).toBe("src/new-name.ts");
		expect(result[0]?.oldPath).toBe("src/old-name.ts");
		expect(result[0]?.additions).toBeGreaterThan(0);
	});

	it("does not set oldPath for non-renamed files", () => {
		const result = parseGitDiff(MODIFIED_FILE_DIFF);
		expect(result[0]?.oldPath).toBeUndefined();
	});

	it("parses a modified file with mixed additions and deletions", () => {
		const result = parseGitDiff(MODIFIED_FILE_DIFF);
		expect(result).toHaveLength(1);
		expect(result[0]?.status).toBe("modified");
		expect(result[0]?.additions).toBe(2);
		expect(result[0]?.deletions).toBe(1);
	});

	it("parses multiple files from a single diff", () => {
		const result = parseGitDiff(MULTI_FILE_DIFF);
		expect(result).toHaveLength(2);
		expect(result[0]?.path).toBe("src/utils.ts");
		expect(result[1]?.path).toBe("src/app.ts");
	});

	it("strips a/ and b/ prefixes from paths", () => {
		const result = parseGitDiff(MODIFIED_FILE_DIFF);
		expect(result[0]?.path).toBe("src/app.ts");
		expect(result[0]?.path).not.toMatch(/^[ab]\//);
	});

	it("transforms hunk lines with correct types and content", () => {
		const result = parseGitDiff(MODIFIED_FILE_DIFF);
		const lines = result[0]?.hunks[0]?.lines;

		const contextLine = lines?.find((l) => l.type === "context");
		expect(contextLine).toBeDefined();
		expect(contextLine?.content).toBe("const a = 1;");

		const additionLine = lines?.find((l) => l.type === "addition" && l.content === "const b = 3;");
		expect(additionLine).toBeDefined();
		expect(additionLine?.newLineNumber).toBeDefined();
		expect(additionLine?.oldLineNumber).toBeUndefined();

		const deletionLine = lines?.find((l) => l.type === "deletion");
		expect(deletionLine).toBeDefined();
		expect(deletionLine?.content).toBe("const b = 2;");
		expect(deletionLine?.oldLineNumber).toBeDefined();
		expect(deletionLine?.newLineNumber).toBeUndefined();
	});

	it("preserves hunk coordinates from @@ headers", () => {
		const twoHunkDiff = `diff --git a/src/app.ts b/src/app.ts
index abc123..def456 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 4;
@@ -100,3 +100,3 @@
 const x = 1;
-const y = 2;
+const y = 3;
 const z = 4;`;

		const result = parseGitDiff(twoHunkDiff);
		expect(result[0]?.hunks).toHaveLength(2);
		expect(result[0]?.hunks[0]?.oldStart).toBe(1);
		expect(result[0]?.hunks[1]?.oldStart).toBe(100);
	});

	it("strips +/- prefix from line content", () => {
		const result = parseGitDiff(ADDED_FILE_DIFF);
		const firstLine = result[0]?.hunks[0]?.lines[0];
		expect(firstLine?.content).toBe("export function hello() {");
		expect(firstLine?.content).not.toMatch(/^\+/);
	});
});

describe("parseGitDiff — embedded diff headers", () => {
	it("does not split on 'diff --git' inside file content", () => {
		const diff = `diff --git a/test-file.ts b/test-file.ts
index abc123..def456 100644
--- a/test-file.ts
+++ b/test-file.ts
@@ -1,3 +1,5 @@
 const PATCH_HEADER = [
+	"diff --git a/src/reviews.ts b/src/reviews.ts",
+	"index abc1234..def5678 100644",
 ].join("\\n");`;

		const result = parseGitDiff(diff);
		expect(result).toHaveLength(1);
		expect(result[0]?.path).toBe("test-file.ts");
		expect(result[0]?.additions).toBe(2);
	});

	it("handles diff --git inside content followed by another real file", () => {
		const diff = `diff --git a/test-file.ts b/test-file.ts
index abc123..def456 100644
--- a/test-file.ts
+++ b/test-file.ts
@@ -1,3 +1,5 @@
 const header = [
+	"diff --git a/inner.ts b/inner.ts",
+	"--- a/inner.ts",
 ].join("\\n");
diff --git a/real-file.ts b/real-file.ts
index 111222..333444 100644
--- a/real-file.ts
+++ b/real-file.ts
@@ -1,2 +1,2 @@
-const x = 1;
+const x = 2;`;

		const result = parseGitDiff(diff);
		expect(result).toHaveLength(2);
		expect(result[0]?.path).toBe("test-file.ts");
		expect(result[1]?.path).toBe("real-file.ts");
	});
});

describe("symlink detection", () => {
	it("detects a new symlink and extracts the target", () => {
		const diff = `diff --git a/link b/link
new file mode 120000
index 0000000..abc1234
--- /dev/null
+++ b/link
@@ -0,0 +1 @@
+../../path/to/target
\\ No newline at end of file`;

		const [file] = parseGitDiff(diff);
		expect(file?.isSymlink).toBe(true);
		expect(file?.symlinkTarget).toBe("../../path/to/target");
		expect(file?.oldSymlinkTarget).toBeUndefined();
	});

	it("detects a deleted symlink and extracts the old target", () => {
		const diff = `diff --git a/link b/link
deleted file mode 120000
index abc1234..0000000
--- a/link
+++ /dev/null
@@ -1 +0,0 @@
-../../path/to/target
\\ No newline at end of file`;

		const [file] = parseGitDiff(diff);
		expect(file?.isSymlink).toBe(true);
		expect(file?.symlinkTarget).toBeUndefined();
		expect(file?.oldSymlinkTarget).toBe("../../path/to/target");
	});

	it("detects a modified symlink and extracts both targets", () => {
		const diff = `diff --git a/link b/link
index abc1234..def5678 120000
--- a/link
+++ b/link
@@ -1 +1 @@
-old/target
+new/target`;

		const [file] = parseGitDiff(diff);
		expect(file?.isSymlink).toBe(true);
		expect(file?.symlinkTarget).toBe("new/target");
		expect(file?.oldSymlinkTarget).toBe("old/target");
		expect(file?.status).toBe("modified");
	});

	it("does not flag regular files as symlinks", () => {
		const files = parseGitDiff(ADDED_FILE_DIFF);
		expect(files[0]?.isSymlink).toBeUndefined();
		expect(files[0]?.symlinkTarget).toBeUndefined();
	});

	it("does not false-positive on paths containing 120000", () => {
		const diff = `diff --git a/legacy/120000-config.ts b/legacy/120000-config.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/legacy/120000-config.ts
@@ -0,0 +1 @@
+export const config = {};`;

		const [file] = parseGitDiff(diff);
		expect(file?.isSymlink).toBeUndefined();
	});
});

describe("calculateDiffStats", () => {
	it("returns zeros for empty array", () => {
		expect(calculateDiffStats([])).toEqual({
			totalAdditions: 0,
			totalDeletions: 0,
			fileCount: 0,
		});
	});

	it("sums additions and deletions across files", () => {
		const files = parseGitDiff(MULTI_FILE_DIFF);
		const stats = calculateDiffStats(files);

		expect(stats.totalAdditions).toBe(5);
		expect(stats.totalDeletions).toBe(1);
		expect(stats.fileCount).toBe(2);
	});
});
