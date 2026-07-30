import { describe, expect, it } from "vitest";
import { type GhReviewThreadNode, mapReviewThread } from "../github/review-comments.js";

const HEAD = "2".repeat(40);

function makeNode(over: Partial<GhReviewThreadNode> = {}): GhReviewThreadNode {
	return {
		id: "RT_node1",
		isResolved: false,
		isOutdated: false,
		path: "src/foo.ts",
		line: 10,
		startLine: null,
		diffSide: "RIGHT",
		startDiffSide: null,
		comments: {
			nodes: [
				{
					fullDatabaseId: "12345",
					body: "Looks wrong",
					url: "https://github.com/o/r/pull/7#discussion_r12345",
					createdAt: "2026-07-01T00:00:00Z",
					viewerDidAuthor: false,
					author: { login: "octocat", avatarUrl: "https://a.example/x.png", name: "Octo Cat" },
				},
			],
		},
		...over,
	};
}

describe("mapReviewThread", () => {
	it("anchors a RIGHT single-line thread to additions when heads match", () => {
		const t = mapReviewThread(makeNode(), { runHeadSha: HEAD, prHeadSha: HEAD });
		expect(t.anchor).toEqual({ side: "additions", startLine: 10, endLine: 10 });
		expect(t.comments[0]?.author.login).toBe("octocat");
	});

	it("maps LEFT ranges to deletions with start/end lines", () => {
		const node = makeNode({ diffSide: "LEFT", startDiffSide: "LEFT", line: 12, startLine: 8 });
		const t = mapReviewThread(node, { runHeadSha: HEAD, prHeadSha: HEAD });
		expect(t.anchor).toEqual({ side: "deletions", startLine: 8, endLine: 12 });
	});

	it("does not anchor a mixed-side range", () => {
		const node = makeNode({ diffSide: "RIGHT", startDiffSide: "LEFT", startLine: 8 });
		expect(mapReviewThread(node, { runHeadSha: HEAD, prHeadSha: HEAD }).anchor).toBeNull();
	});

	it("does not anchor when GitHub marks the thread outdated or line is gone", () => {
		expect(
			mapReviewThread(makeNode({ isOutdated: true }), { runHeadSha: HEAD, prHeadSha: HEAD }).anchor,
		).toBeNull();
		expect(
			mapReviewThread(makeNode({ line: null }), { runHeadSha: HEAD, prHeadSha: HEAD }).anchor,
		).toBeNull();
	});

	it("does not anchor any thread when the PR head moved past the imported run", () => {
		const t = mapReviewThread(makeNode(), { runHeadSha: HEAD, prHeadSha: "f".repeat(40) });
		expect(t.anchor).toBeNull();
	});

	it("substitutes a ghost author when the account is deleted", () => {
		const node = makeNode();
		const first = node.comments.nodes[0];
		if (!first) throw new Error("fixture has no comments");
		node.comments.nodes[0] = { ...first, author: null };
		const t = mapReviewThread(node, { runHeadSha: HEAD, prHeadSha: HEAD });
		expect(t.comments[0]?.author.login).toBe("ghost");
	});
});
