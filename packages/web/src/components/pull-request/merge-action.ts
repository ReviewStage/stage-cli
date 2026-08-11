import type { MergeStatusInfo } from "@stagereview/types/pull-request";
import { MERGE_STATUS, type MergeStatus } from "./merge-status-summary";

export const MERGE_ACTION = {
	MERGE: "MERGE",
	ENABLE_AUTO_MERGE: "ENABLE_AUTO_MERGE",
	DISABLE_AUTO_MERGE: "DISABLE_AUTO_MERGE",
	REMOVE_FROM_QUEUE: "REMOVE_FROM_QUEUE",
	NONE: "NONE",
} as const;
export type MergeAction = (typeof MERGE_ACTION)[keyof typeof MERGE_ACTION];

/**
 * The single action the merge button should offer — pure, and keyed on GitHub's own
 * flags. `viewerCanEnableAutoMerge` already encodes conflicts and branch protection,
 * so this never offers an action GitHub would reject. A pending intent (queue or
 * auto-merge) is undone before Merge is offered; leaving the queue needs only write
 * access, while disabling auto-merge needs `viewerCanDisableAutoMerge`.
 */
export function getMergeAction(
	status: MergeStatus,
	mergeInfo: MergeStatusInfo,
	canMutate: boolean,
): MergeAction {
	if (!canMutate) {
		return MERGE_ACTION.NONE;
	}

	if (mergeInfo.isInMergeQueue && mergeInfo.entry !== null) {
		return MERGE_ACTION.REMOVE_FROM_QUEUE;
	}
	if (mergeInfo.autoMergeEnabled && mergeInfo.viewerCanDisableAutoMerge) {
		return MERGE_ACTION.DISABLE_AUTO_MERGE;
	}

	if (
		status === MERGE_STATUS.READY &&
		(mergeInfo.isMergeQueueEnabled || mergeInfo.allowedMergeMethods.length > 0)
	) {
		return MERGE_ACTION.MERGE;
	}

	if (mergeInfo.viewerCanEnableAutoMerge) {
		return MERGE_ACTION.ENABLE_AUTO_MERGE;
	}

	return MERGE_ACTION.NONE;
}
