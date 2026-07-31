import type { CommentThread } from "@stagereview/types/comments";
import type { GitHubComment, GitHubThread } from "@stagereview/types/github-threads";
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

function makeGitHubComment(): GitHubComment {
	return {
		githubCommentId: "12345",
		body: "Needs a null check.",
		author: { login: "octocat", name: "Mona", avatarUrl: null },
		createdAt: "2026-07-01T00:00:00Z",
		url: "https://github.com/o/r/pull/1#discussion_r12345",
		viewerDidAuthor: false,
	};
}

function makeGitHub(over: Partial<GitHubThread> = {}): GitHubThread {
	return {
		githubThreadId: "RT_1",
		filePath: "src/foo.ts",
		anchor: { side: "additions", startLine: 10, endLine: 10 },
		isResolved: false,
		comments: [makeGitHubComment()],
		...over,
	};
}

describe("mergeThreads", () => {
	it("combines local and anchored GitHub threads into a single per-file group", () => {
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

	it("keys threads by file path across multiple files", () => {
		const { byFile } = mergeThreads(
			[makeLocal({ id: "t-a", filePath: "src/a.ts" })],
			[makeGitHub({ githubThreadId: "RT_b", filePath: "src/b.ts" })],
		);
		expect(byFile.size).toBe(2);
		expect(byFile.get("src/a.ts")).toHaveLength(1);
		expect(byFile.get("src/b.ts")).toHaveLength(1);
		expect(byFile.get("src/a.ts")?.[0]?.kind).toBe("local");
		expect(byFile.get("src/b.ts")?.[0]?.kind).toBe("github");
	});

	it("drops GitHub threads whose comments were all deleted, anchored or not", () => {
		const { byFile, outdated } = mergeThreads(
			[],
			[
				makeGitHub({ comments: [] }),
				makeGitHub({ githubThreadId: "RT_2", anchor: null, comments: [] }),
			],
		);
		expect(byFile.size).toBe(0);
		expect(outdated).toHaveLength(0);
	});

	it("returns empty results for empty input without throwing", () => {
		const { byFile, outdated } = mergeThreads([], []);
		expect(byFile.size).toBe(0);
		expect(outdated).toHaveLength(0);
	});

	it("preserves local-before-github order for threads tied on start line", () => {
		const { byFile } = mergeThreads(
			[makeLocal({ startLine: 10, endLine: 10 })],
			[makeGitHub({ anchor: { side: "additions", startLine: 10, endLine: 10 } })],
		);
		const threads = byFile.get("src/foo.ts") ?? [];
		expect(threads.map((t) => t.kind)).toEqual(["local", "github"]);
	});
});
