import type { LocalReviewThread as CommentThread } from "@stagereview/types/review";
import { describe, expect, it } from "vitest";
import {
	buildCommentAnnotations,
	type CommentDraft,
	clearDraftBody,
	type DraftBodies,
	type DraftState,
	findDraftAt,
	isSameAnchor,
	readDraftBody,
	upsertDraft,
	writeDraftBody,
} from "../comment-drafts";

function makeThread(
	over: Partial<CommentThread> & Pick<CommentThread, "side" | "endLine">,
): CommentThread {
	return {
		id: `t-${over.side}-${over.endLine}`,
		source: "local",
		threadNodeId: null,
		filePath: "a.ts",
		startLine: over.endLine,
		isResolved: false,
		comments: [],
		...over,
	};
}

function draftState(side: CommentDraft["side"], startLine: number, endLine: number): DraftState {
	return { side, startLine, endLine, creationId: `draft-${side}-${endLine}`, error: null };
}

function rowFor(
	annotations: ReturnType<typeof buildCommentAnnotations>,
	side: CommentDraft["side"],
	lineNumber: number,
) {
	return annotations.find((a) => a.side === side && a.lineNumber === lineNumber);
}

describe("buildCommentAnnotations", () => {
	it("returns no annotations for no threads and no drafts", () => {
		expect(buildCommentAnnotations([], [])).toEqual([]);
	});

	it("groups multiple threads on the same row into one annotation", () => {
		const annotations = buildCommentAnnotations(
			[
				makeThread({ id: "t1", side: "additions", endLine: 5 }),
				makeThread({ id: "t2", side: "additions", endLine: 5 }),
			],
			[],
		);
		expect(annotations).toHaveLength(1);
		expect(rowFor(annotations, "additions", 5)?.metadata).toHaveLength(2);
	});

	it("creates a thread-less row per open draft", () => {
		const annotations = buildCommentAnnotations(
			[],
			[draftState("additions", 5, 5), draftState("deletions", 8, 10)],
		);
		expect(annotations).toHaveLength(2);
		expect(rowFor(annotations, "additions", 5)?.metadata).toEqual([]);
		expect(rowFor(annotations, "deletions", 10)?.metadata).toEqual([]);
	});

	it("shares one row when a draft and a thread anchor to the same (side, endLine)", () => {
		const annotations = buildCommentAnnotations(
			[makeThread({ side: "additions", endLine: 5 })],
			[draftState("additions", 3, 5)],
		);
		expect(annotations).toHaveLength(1);
		expect(rowFor(annotations, "additions", 5)?.metadata).toHaveLength(1);
	});
});

describe("draft anchor helpers", () => {
	const additionsDraft = draftState("additions", 5, 5);
	const deletionsDraft = { ...draftState("deletions", 8, 10), error: "boom" as string | null };
	const drafts = [additionsDraft, deletionsDraft];

	it("matches a draft by side and endLine only", () => {
		expect(isSameAnchor(additionsDraft, "additions", 5)).toBe(true);
		expect(isSameAnchor(additionsDraft, "deletions", 5)).toBe(false);
		expect(isSameAnchor(deletionsDraft, "deletions", 10)).toBe(true);
	});

	it("finds the draft occupying a given row, or undefined", () => {
		expect(findDraftAt(drafts, "deletions", 10)?.error).toBe("boom");
		expect(findDraftAt(drafts, "additions", 99)).toBeUndefined();
	});
});

describe("upsertDraft", () => {
	it("appends a new draft when no composer occupies the row", () => {
		const result = upsertDraft([draftState("additions", 5, 5)], draftState("deletions", 8, 10));
		expect(result).toHaveLength(2);
		expect(findDraftAt(result, "deletions", 10)?.startLine).toBe(8);
	});

	it("adopts the new startLine when re-opening the same (side, endLine) row", () => {
		const existing = { ...draftState("additions", 3, 10), error: "boom" as string | null };
		const result = upsertDraft([existing], draftState("additions", 7, 10));
		expect(result).toHaveLength(1);
		expect(result[0]?.startLine).toBe(7);
		expect(result[0]?.creationId).toBe(existing.creationId);
		// A re-drag clears any stale submit error.
		expect(result[0]?.error).toBeNull();
	});

	it("leaves other open drafts untouched when updating one", () => {
		const other = draftState("deletions", 1, 4);
		const result = upsertDraft(
			[other, draftState("additions", 3, 10)],
			draftState("additions", 7, 10),
		);
		expect(result).toContain(other);
		expect(findDraftAt(result, "additions", 10)?.startLine).toBe(7);
	});

	it("opens a separate composer for a different endLine", () => {
		const result = upsertDraft([draftState("additions", 3, 10)], draftState("additions", 3, 15));
		expect(result).toHaveLength(2);
	});
});

describe("draft body store", () => {
	it("reads, writes, and clears text keyed by (side, endLine)", () => {
		const bodies: DraftBodies = new Map();
		expect(readDraftBody(bodies, "additions", 5)).toBe("");

		writeDraftBody(bodies, "additions", 5, "hello");
		writeDraftBody(bodies, "deletions", 5, "other side");
		expect(readDraftBody(bodies, "additions", 5)).toBe("hello");
		// Same line number on the other side is a distinct entry.
		expect(readDraftBody(bodies, "deletions", 5)).toBe("other side");

		clearDraftBody(bodies, "additions", 5);
		expect(readDraftBody(bodies, "additions", 5)).toBe("");
		expect(readDraftBody(bodies, "deletions", 5)).toBe("other side");
	});
});
