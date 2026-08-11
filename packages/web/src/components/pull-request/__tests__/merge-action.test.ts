import type { MergeStatusInfo } from "@stagereview/types/pull-request";
import { describe, expect, it } from "vitest";
import { getMergeAction, MERGE_ACTION } from "../merge-action";
import { MERGE_STATUS } from "../merge-status-summary";

function createMergeStatus(overrides: Partial<MergeStatusInfo> = {}): MergeStatusInfo {
	return {
		mergeable: "MERGEABLE",
		mergeStateStatus: "CLEAN",
		reviewDecision: null,
		checkRollupState: "SUCCESS",
		autoMergeEnabled: false,
		autoMergeAllowed: true,
		viewerCanEnableAutoMerge: true,
		viewerCanDisableAutoMerge: true,
		isMergeQueueEnabled: false,
		isInMergeQueue: false,
		entry: null,
		allowedMergeMethods: ["SQUASH"],
		...overrides,
	};
}

describe("getMergeAction", () => {
	it("returns NONE for read-only viewers regardless of state", () => {
		expect(getMergeAction(MERGE_STATUS.READY, createMergeStatus(), false)).toBe(MERGE_ACTION.NONE);
	});

	it("returns MERGE when ready with an allowed method", () => {
		expect(getMergeAction(MERGE_STATUS.READY, createMergeStatus(), true)).toBe(MERGE_ACTION.MERGE);
	});

	it("returns MERGE when ready on a merge-queue repo (enqueue path, no methods)", () => {
		const info = createMergeStatus({ isMergeQueueEnabled: true, allowedMergeMethods: [] });
		expect(getMergeAction(MERGE_STATUS.READY, info, true)).toBe(MERGE_ACTION.MERGE);
	});

	it("prefers DISABLE_AUTO_MERGE over MERGE when ready but auto-merge is already enabled", () => {
		// A queue-repo PR that just turned ready but isn't enqueued yet must surface
		// undoing the live auto-merge intent, not a Merge that enqueues over it.
		const info = createMergeStatus({
			isMergeQueueEnabled: true,
			isInMergeQueue: false,
			autoMergeEnabled: true,
			viewerCanDisableAutoMerge: true,
			allowedMergeMethods: [],
		});
		expect(getMergeAction(MERGE_STATUS.READY, info, true)).toBe(MERGE_ACTION.DISABLE_AUTO_MERGE);
	});

	it("returns NONE when ready but no method and no queue", () => {
		const info = createMergeStatus({
			allowedMergeMethods: [],
			viewerCanEnableAutoMerge: false,
			viewerCanDisableAutoMerge: false,
		});
		expect(getMergeAction(MERGE_STATUS.READY, info, true)).toBe(MERGE_ACTION.NONE);
	});

	it("returns ENABLE_AUTO_MERGE when blocked but the viewer can enable auto-merge", () => {
		const info = createMergeStatus({ mergeStateStatus: "BLOCKED", viewerCanEnableAutoMerge: true });
		expect(getMergeAction(MERGE_STATUS.BLOCKED, info, true)).toBe(MERGE_ACTION.ENABLE_AUTO_MERGE);
	});

	it("returns ENABLE_AUTO_MERGE when behind but the viewer can enable auto-merge", () => {
		const info = createMergeStatus({ mergeStateStatus: "BEHIND", viewerCanEnableAutoMerge: true });
		expect(getMergeAction(MERGE_STATUS.BEHIND, info, true)).toBe(MERGE_ACTION.ENABLE_AUTO_MERGE);
	});

	it("returns NONE on conflicts (GitHub forbids auto-merge — flag is false)", () => {
		const info = createMergeStatus({
			mergeable: "CONFLICTING",
			mergeStateStatus: "DIRTY",
			viewerCanEnableAutoMerge: false,
			viewerCanDisableAutoMerge: false,
		});
		expect(getMergeAction(MERGE_STATUS.CONFLICTS, info, true)).toBe(MERGE_ACTION.NONE);
	});

	it("returns DISABLE_AUTO_MERGE when auto-merge is already enabled", () => {
		const info = createMergeStatus({
			mergeStateStatus: "BLOCKED",
			autoMergeEnabled: true,
			viewerCanDisableAutoMerge: true,
		});
		expect(getMergeAction(MERGE_STATUS.BLOCKED, info, true)).toBe(MERGE_ACTION.DISABLE_AUTO_MERGE);
	});

	it("returns REMOVE_FROM_QUEUE when in the merge queue", () => {
		const info = createMergeStatus({
			isMergeQueueEnabled: true,
			isInMergeQueue: true,
			entry: { id: "MQE_1", position: 3, estimatedTimeToMerge: null },
			viewerCanDisableAutoMerge: true,
		});
		expect(getMergeAction(MERGE_STATUS.READY, info, true)).toBe(MERGE_ACTION.REMOVE_FROM_QUEUE);
	});

	it("prefers REMOVE_FROM_QUEUE when a queued PR also has auto-merge enabled", () => {
		const info = createMergeStatus({
			isMergeQueueEnabled: true,
			isInMergeQueue: true,
			entry: { id: "MQE_3", position: 1, estimatedTimeToMerge: null },
			autoMergeEnabled: true,
			viewerCanDisableAutoMerge: true,
		});
		expect(getMergeAction(MERGE_STATUS.READY, info, true)).toBe(MERGE_ACTION.REMOVE_FROM_QUEUE);
	});

	it("returns REMOVE_FROM_QUEUE for a directly-enqueued PR without auto-merge-disable permission", () => {
		// A direct enqueue leaves autoMergeEnabled false; removing from the queue must
		// not be gated on viewerCanDisableAutoMerge, which only governs auto-merge requests.
		const info = createMergeStatus({
			isMergeQueueEnabled: true,
			isInMergeQueue: true,
			entry: { id: "MQE_2", position: 1, estimatedTimeToMerge: null },
			autoMergeEnabled: false,
			viewerCanDisableAutoMerge: false,
		});
		expect(getMergeAction(MERGE_STATUS.READY, info, true)).toBe(MERGE_ACTION.REMOVE_FROM_QUEUE);
	});

	it("prefers DISABLE_AUTO_MERGE over enabling a new intent when one is already set", () => {
		const info = createMergeStatus({
			mergeStateStatus: "BLOCKED",
			autoMergeEnabled: true,
			viewerCanEnableAutoMerge: true,
			viewerCanDisableAutoMerge: true,
		});
		expect(getMergeAction(MERGE_STATUS.BLOCKED, info, true)).toBe(MERGE_ACTION.DISABLE_AUTO_MERGE);
	});

	it("returns NONE when blocked and no auto-merge path exists", () => {
		const info = createMergeStatus({
			mergeStateStatus: "BLOCKED",
			autoMergeAllowed: false,
			viewerCanEnableAutoMerge: false,
			viewerCanDisableAutoMerge: false,
		});
		expect(getMergeAction(MERGE_STATUS.BLOCKED, info, true)).toBe(MERGE_ACTION.NONE);
	});
});
