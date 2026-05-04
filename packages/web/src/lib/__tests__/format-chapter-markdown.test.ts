import { describe, expect, it } from "vitest";
import { FILE_STATUS, type PullRequestFile } from "../diff-types";
import { formatChapterAsMarkdown } from "../format-chapter-markdown";

const baseFile: PullRequestFile = {
	path: "src/foo.ts",
	filename: "foo.ts",
	status: FILE_STATUS.MODIFIED,
	additions: 5,
	deletions: 2,
	hunks: [],
};

describe("formatChapterAsMarkdown", () => {
	it("renders title, summary, key changes, and files in order", () => {
		const md = formatChapterAsMarkdown(
			{
				id: "c1",
				externalId: "ext-c1",
				order: 1,
				title: "Wire org ID",
				summary: "Threads orgId through.",
				hunkRefs: [],
				keyChanges: [
					{ id: "k1", externalId: "ext-k1", content: "Check the auth path", lineRefs: [] },
					{ id: "k2", externalId: "ext-k2", content: "Verify the SQL query", lineRefs: [] },
				],
			},
			0,
			[{ file: baseFile }],
		);
		expect(md).toContain("# Chapter 1: Wire org ID");
		expect(md).toContain("Threads orgId through.");
		expect(md).toContain("## What to Review\n- Check the auth path\n- Verify the SQL query");
		expect(md).toContain("## Files\n- src/foo.ts (modified, +5 -2)");
	});

	it("renders rename arrows when oldPath differs from path", () => {
		const md = formatChapterAsMarkdown(
			{
				id: "c1",
				externalId: "ext-c1",
				order: 1,
				title: "Move it",
				summary: "Renamed.",
				hunkRefs: [],
				keyChanges: [],
			},
			0,
			[
				{
					file: {
						...baseFile,
						status: FILE_STATUS.RENAMED,
						oldPath: "src/old.ts",
						path: "src/new.ts",
						additions: 0,
						deletions: 0,
					},
				},
			],
		);
		expect(md).toContain("- src/old.ts → src/new.ts (renamed)");
	});

	it("omits sections when their content is empty", () => {
		const md = formatChapterAsMarkdown(
			{
				id: "c1",
				externalId: "ext-c1",
				order: 1,
				title: "Empty",
				summary: "",
				hunkRefs: [],
				keyChanges: [],
			},
			0,
			[],
		);
		expect(md).toBe("# Chapter 1: Empty");
	});
});
