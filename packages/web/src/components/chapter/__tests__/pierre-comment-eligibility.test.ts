import { describe, expect, it } from "vitest";
import { getSingularPatch, isGitHubReviewAnchor } from "../pierre-diff-viewer";

const DIFF = getSingularPatch(`diff --git a/src/file.ts b/src/file.ts
index 1111111..2222222 100644
--- a/src/file.ts
+++ b/src/file.ts
@@ -1,3 +1,3 @@
 const one = 1;
-const two = 2;
+const two = 22;
 const three = 3;
@@ -10,3 +10,3 @@
 const ten = 10;
-const eleven = 11;
+const eleven = 111;
 const twelve = 12;
`);

describe("GitHub review anchor eligibility", () => {
	it("accepts a line inside one diff hunk", () => {
		expect(
			isGitHubReviewAnchor(DIFF.hunks, {
				side: "additions",
				startLine: 2,
				endLine: 2,
			}),
		).toBe(true);
	});

	it("rejects an expanded unchanged line outside every diff hunk", () => {
		expect(
			isGitHubReviewAnchor(DIFF.hunks, {
				side: "additions",
				startLine: 6,
				endLine: 6,
			}),
		).toBe(false);
	});

	it("rejects a range spanning separate diff hunks", () => {
		expect(
			isGitHubReviewAnchor(DIFF.hunks, {
				side: "additions",
				startLine: 2,
				endLine: 11,
			}),
		).toBe(false);
	});
});
