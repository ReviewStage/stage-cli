// @vitest-environment happy-dom

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFileDiffEntries } from "../parse-diff";

const ADD_PATCH = `diff --git a/src/foo.ts b/src/foo.ts
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/src/foo.ts
@@ -0,0 +1,3 @@
+export const greet = "hello";
+
+greet();
`;

const MODIFY_PATCH = `diff --git a/README.md b/README.md
index abc1234..def5678 100644
--- a/README.md
+++ b/README.md
@@ -1,3 +1,4 @@
 # stage-cli

-Old line.
+New line one.
+New line two.
`;

const RENAME_PATCH = `diff --git a/old-name.ts b/new-name.ts
similarity index 100%
rename from old-name.ts
rename to new-name.ts
`;

const TWO_FILE_PATCH = ADD_PATCH + MODIFY_PATCH;

describe("useFileDiffEntries", () => {
	it("returns an empty list for empty input", () => {
		const { result } = renderHook(() => useFileDiffEntries(""));
		expect(result.current).toEqual([]);
	});

	it("returns an empty list for undefined input", () => {
		const { result } = renderHook(() => useFileDiffEntries(undefined));
		expect(result.current).toEqual([]);
	});

	it("parses a single-file added patch with addition counts", () => {
		const { result } = renderHook(() => useFileDiffEntries(ADD_PATCH));
		expect(result.current).toHaveLength(1);
		const entry = result.current[0];
		if (!entry) throw new Error("expected one entry");
		expect(entry.file.path).toBe("src/foo.ts");
		expect(entry.file.status).toBe("added");
		expect(entry.file.additions).toBe(3);
		expect(entry.file.deletions).toBe(0);
	});

	it("parses a modify patch with mixed additions and deletions", () => {
		const { result } = renderHook(() => useFileDiffEntries(MODIFY_PATCH));
		expect(result.current).toHaveLength(1);
		const entry = result.current[0];
		if (!entry) throw new Error("expected one entry");
		expect(entry.file.path).toBe("README.md");
		expect(entry.file.status).toBe("modified");
		expect(entry.file.additions).toBe(2);
		expect(entry.file.deletions).toBe(1);
	});

	it("parses a pure rename patch as MOVED with the new path and oldPath set", () => {
		const { result } = renderHook(() => useFileDiffEntries(RENAME_PATCH));
		expect(result.current).toHaveLength(1);
		const entry = result.current[0];
		if (!entry) throw new Error("expected one entry");
		expect(entry.file.path).toBe("new-name.ts");
		expect(entry.file.oldPath).toBe("old-name.ts");
		expect(entry.file.status).toBe("moved");
	});

	it("flattens multiple files in one patch into a single flat list", () => {
		const { result } = renderHook(() => useFileDiffEntries(TWO_FILE_PATCH));
		expect(result.current).toHaveLength(2);
		expect(result.current.map((e) => e.file.path)).toEqual(["src/foo.ts", "README.md"]);
	});
});
