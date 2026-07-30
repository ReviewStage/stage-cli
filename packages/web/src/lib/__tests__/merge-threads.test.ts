import type { CommentThread } from "@stagereview/types/comments";
import type { GitHubThread } from "@stagereview/types/github-threads";
import { describe, expect, it } from "vitest";
import { type DisplayThread, mergeThreads } from "../merge-threads";

function makeLocal(over: Partial<CommentThread> = {}): CommentThread {
	return {
		id: "t1",
		filePath: "src/foo.ts",
		side: "additions",
		startLine: 5,
		endLine: 5,
		pending: true,
		resolvedAt: null,
		createdAt: "2026-07-01T00:00:00Z",
		updatedAt: "2026-07-01T00:00:00Z",
		comments: [],
		...over,
	};
}

function makeGitHub(over: Partial<GitHubThread> = {}): GitHubThread {
	return {
		githubThreadId: "RT_1",
		filePath: "src/foo.ts",
		anchor: { side: "additions", startLine: 10, endLine: 10 },
		isResolved: false,
		comments: [],
		...over,
	};
}

describe("mergeThreads", () => {
	it("groups local and anchored GitHub threads by file", () => {
		const { byFile, outdated } = mergeThreads([makeLocal()], [makeGitHub()]);
		const threads = byFile.get("src/foo.ts") ?? [];
		expect(threads).toHaveLength(2);
		expect(threads.map((t: DisplayThread) => t.kind)).toEqual(["local", "github"]);
		expect(outdated).toHaveLength(0);
	});

	it("routes unanchorable GitHub threads to the outdated list", () => {
		const { byFile, outdated } = mergeThreads([], [makeGitHub({ anchor: null })]);
		expect(byFile.size).toBe(0);
		expect(outdated).toHaveLength(1);
	});

	it("sorts threads within a file by anchor start line", () => {
		const { byFile } = mergeThreads(
			[makeLocal({ startLine: 20, endLine: 20 })],
			[makeGitHub({ anchor: { side: "additions", startLine: 3, endLine: 3 } })],
		);
		const threads = byFile.get("src/foo.ts") ?? [];
		expect(threads[0]?.kind).toBe("github");
	});
});
