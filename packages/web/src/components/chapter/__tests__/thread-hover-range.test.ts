import type { GitHubLineReviewThread } from "@stagereview/types/review";
import { describe, expect, it } from "vitest";
import { getThreadHoverRange } from "../thread-hover-range";

describe("getThreadHoverRange", () => {
	it("keeps the start and end on their original sides", () => {
		const thread: GitHubLineReviewThread = {
			id: "thread",
			source: "github",
			subjectType: "LINE",
			threadNodeId: "thread",
			viewerCanResolve: true,
			viewerCanUnresolve: true,
			viewerCanReply: true,
			filePath: "src/file.ts",
			startSide: "deletions",
			side: "additions",
			startLine: 8,
			endLine: 10,
			isResolved: false,
			comments: [],
		};

		expect(getThreadHoverRange(thread)).toEqual({
			start: 8,
			side: "deletions",
			end: 10,
			endSide: "additions",
		});
	});
});
