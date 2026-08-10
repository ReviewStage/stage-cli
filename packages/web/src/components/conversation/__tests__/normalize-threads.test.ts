import type { ResolvedThreadInfo, TimelineReviewComment } from "@stagereview/types";
import { describe, expect, it } from "vitest";
import { groupIntoThreads, normalizeReviewComments } from "../normalize-threads";

function makeComment(
	overrides: Partial<TimelineReviewComment> & { id: number },
): TimelineReviewComment {
	return {
		node_id: `PRRC_${overrides.id}`,
		body: "comment",
		body_html: "<p>comment</p>",
		path: "src/index.ts",
		line: 10,
		side: "RIGHT",
		created_at: "2024-01-01T00:00:00Z",
		html_url: `https://github.com/owner/repo/pull/1#discussion_r${overrides.id}`,
		user: { login: "author", avatar_url: "https://github.com/author.png", type: "User" },
		...overrides,
	};
}

describe("groupIntoThreads — resolved threads", () => {
	it("marks threads as resolved when in resolvedThreads map", () => {
		const root = makeComment({ id: 1 });
		const resolvedThreads = new Map<number, ResolvedThreadInfo>([[1, { login: "resolver" }]]);

		const threads = groupIntoThreads([root], resolvedThreads);

		expect(threads).toHaveLength(1);
		expect(threads[0]?.isResolved).toBe(true);
		expect(threads[0]?.resolvedBy).toEqual({ login: "resolver" });
	});

	it("marks threads as unresolved when not in resolvedThreads map", () => {
		const root = makeComment({ id: 1 });
		const resolvedThreads = new Map<number, ResolvedThreadInfo>([[999, { login: "resolver" }]]);

		const threads = groupIntoThreads([root], resolvedThreads);

		expect(threads).toHaveLength(1);
		expect(threads[0]?.isResolved).toBe(false);
		expect(threads[0]?.resolvedBy).toBeNull();
	});

	it("marks all threads as unresolved when resolvedThreads is undefined", () => {
		const root1 = makeComment({ id: 1 });
		const root2 = makeComment({ id: 2, created_at: "2024-01-02T00:00:00Z" });

		const threads = groupIntoThreads([root1, root2], undefined);

		expect(threads).toHaveLength(2);
		expect(threads.every((thread) => !thread.isResolved && thread.resolvedBy === null)).toBe(true);
	});

	it("correctly assigns resolvedBy data per thread", () => {
		const root1 = makeComment({ id: 1 });
		const root2 = makeComment({ id: 2, created_at: "2024-01-02T00:00:00Z" });
		const root3 = makeComment({ id: 3, created_at: "2024-01-03T00:00:00Z" });

		const resolvedThreads = new Map<number, ResolvedThreadInfo>([
			[1, { login: "alice" }],
			[3, { login: "bob" }],
		]);

		const threads = groupIntoThreads([root1, root2, root3], resolvedThreads);

		expect(threads).toHaveLength(3);
		expect(threads[0]?.resolvedBy).toEqual({ login: "alice" });
		expect(threads[1]?.resolvedBy).toBeNull();
		expect(threads[2]?.resolvedBy).toEqual({ login: "bob" });
	});

	it("returns empty array for empty comments", () => {
		expect(groupIntoThreads([], new Map())).toEqual([]);
	});

	it("groups replies under root and preserves resolved status", () => {
		const root = makeComment({ id: 1 });
		const reply = makeComment({
			id: 2,
			in_reply_to_id: 1,
			created_at: "2024-01-02T00:00:00Z",
		});
		const resolvedThreads = new Map<number, ResolvedThreadInfo>([[1, { login: "resolver" }]]);

		const threads = groupIntoThreads([root, reply], resolvedThreads);

		expect(threads).toHaveLength(1);
		expect(threads[0]?.root.id).toBe(1);
		expect(threads[0]?.replies.map((r) => r.id)).toEqual([2]);
		expect(threads[0]?.isResolved).toBe(true);
	});

	it("keeps comments from deleted accounts as the ghost user", () => {
		const ghost = makeComment({ id: 1, user: null });
		const threads = groupIntoThreads([ghost]);
		expect(threads).toHaveLength(1);
		expect(threads[0]?.root.user.login).toBe("ghost");
	});
});

describe("normalizeReviewComments", () => {
	it("slices the diff preview with original coordinates and maps sides", () => {
		const root = makeComment({
			id: 1,
			side: "LEFT",
			line: 12,
			original_line: 10,
			diff_hunk: "@@ -8,5 +8,6 @@\n old\n-removed\n+added",
		});

		const threads = normalizeReviewComments([root]);
		const thread = threads[0];
		if (!thread) throw new Error("expected a thread");

		expect(thread.side).toBe("LEFT");
		// LEFT-side threads prefer the original (frozen) line
		expect(thread.line).toBe(10);
		expect(thread.diffPreview).toEqual({
			diffHunk: "@@ -8,5 +8,6 @@\n old\n-removed\n+added",
			line: 10,
			startLine: null,
		});
	});

	it("normalizes file-level comments to the FILE subject type", () => {
		const root = makeComment({ id: 1, subject_type: "file", line: null });
		const thread = normalizeReviewComments([root])[0];
		if (!thread) throw new Error("expected a thread");
		expect(thread.subjectType).toBe("FILE");
	});
});
