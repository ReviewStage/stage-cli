// @vitest-environment happy-dom

import type { GitHubLineReviewThread } from "@stagereview/types/review";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useThreadHover } from "../use-thread-hover";

const thread: GitHubLineReviewThread = {
	id: "thread",
	source: "github",
	subjectType: "LINE",
	threadNodeId: "THREAD_1",
	viewerCanResolve: true,
	viewerCanUnresolve: true,
	viewerCanReply: true,
	filePath: "src/file.ts",
	startSide: "additions",
	side: "additions",
	startLine: 3,
	endLine: 5,
	isResolved: false,
	comments: [],
};

describe("useThreadHover", () => {
	it("clears hover state when the hovered thread unmounts", () => {
		const { result, rerender } = renderHook(
			({ threads }: { threads: GitHubLineReviewThread[] }) => useThreadHover(threads),
			{ initialProps: { threads: [thread] } },
		);
		act(() => result.current.enter(thread));
		expect(result.current.isHovering()).toBe(true);
		expect(result.current.hoverLines).not.toBeNull();

		rerender({ threads: [] });

		expect(result.current.isHovering()).toBe(false);
		expect(result.current.hoverLines).toBeNull();
	});
});
