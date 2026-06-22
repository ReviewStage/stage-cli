import { describe, expect, it } from "vitest";
import type { ReviewComment } from "../github/index.js";
import {
	fromGitHubSide,
	groupReviewComments,
	toGitHubSide,
} from "../runs/review-comment-mapping.js";

function comment(over: Partial<ReviewComment> & { id: number }): ReviewComment {
	return {
		in_reply_to_id: null,
		path: "src/foo.ts",
		line: 10,
		start_line: null,
		side: "RIGHT",
		body: "body",
		created_at: "2026-01-01T00:00:00Z",
		user: { login: "octocat", avatar_url: "https://example.com/a.png", type: "User" },
		...over,
	};
}

describe("side mapping", () => {
	it("maps local sides to GitHub diff sides", () => {
		expect(toGitHubSide("deletions")).toBe("LEFT");
		expect(toGitHubSide("additions")).toBe("RIGHT");
	});

	it("maps GitHub diff sides back to local sides, defaulting unknown to additions", () => {
		expect(fromGitHubSide("LEFT")).toBe("deletions");
		expect(fromGitHubSide("RIGHT")).toBe("additions");
		expect(fromGitHubSide(null)).toBe("additions");
		expect(fromGitHubSide(undefined)).toBe("additions");
	});
});

describe("groupReviewComments", () => {
	it("nests replies under their root and orders them oldest-first", () => {
		const threads = groupReviewComments([
			comment({ id: 1, body: "root" }),
			comment({
				id: 3,
				in_reply_to_id: 1,
				body: "second reply",
				created_at: "2026-01-03T00:00:00Z",
			}),
			comment({
				id: 2,
				in_reply_to_id: 1,
				body: "first reply",
				created_at: "2026-01-02T00:00:00Z",
			}),
		]);
		expect(threads).toHaveLength(1);
		expect(threads[0]?.root.id).toBe(1);
		expect(threads[0]?.replies.map((r) => r.id)).toEqual([2, 3]);
	});

	it("derives the anchor from start_line/line and side", () => {
		const [thread] = groupReviewComments([
			comment({ id: 1, side: "LEFT", start_line: 4, line: 8, path: "src/bar.ts" }),
		]);
		expect(thread).toMatchObject({
			filePath: "src/bar.ts",
			side: "deletions",
			startLine: 4,
			endLine: 8,
		});
	});

	it("falls back to line for single-line comments", () => {
		const [thread] = groupReviewComments([comment({ id: 1, start_line: null, line: 12 })]);
		expect(thread?.startLine).toBe(12);
		expect(thread?.endLine).toBe(12);
	});

	it("drops comments with no anchorable line (outdated/whole-file)", () => {
		const threads = groupReviewComments([comment({ id: 1, line: null })]);
		expect(threads).toEqual([]);
	});
});
