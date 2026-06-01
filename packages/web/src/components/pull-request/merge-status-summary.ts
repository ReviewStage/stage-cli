import {
	CHECK_ROLLUP_STATE,
	MERGE_STATE_STATUS,
	MERGEABLE_STATE,
	type MergeStatusInfo,
} from "@stagereview/types/pull-request";
import { AlertTriangle, Check, Loader2, type LucideIcon, XCircle } from "lucide-react";

export const MERGE_STATUS = {
	CHECKING: "CHECKING",
	CONFLICTS: "CONFLICTS",
	IN_MERGE_QUEUE: "IN_MERGE_QUEUE",
	READY: "READY",
	BEHIND: "BEHIND",
	BLOCKED: "BLOCKED",
} as const;

type MergeStatus = (typeof MERGE_STATUS)[keyof typeof MERGE_STATUS];

export interface MergeStatusSummary {
	status: MergeStatus;
	label: string;
	icon: LucideIcon;
	iconColor: string;
	accentColor: string;
	pillBg: string;
	isTransient: boolean;
}

function isChecksPending(info: MergeStatusInfo): boolean {
	return (
		info.checkRollupState === CHECK_ROLLUP_STATE.PENDING ||
		info.checkRollupState === CHECK_ROLLUP_STATE.EXPECTED
	);
}

export function getMergeStatusSummary(info: MergeStatusInfo): MergeStatusSummary {
	const { mergeable, mergeStateStatus, isInMergeQueue, entry } = info;

	if (mergeable === MERGEABLE_STATE.UNKNOWN || mergeStateStatus === MERGE_STATE_STATUS.UNKNOWN) {
		return {
			status: MERGE_STATUS.CHECKING,
			label: "Checking…",
			icon: Loader2,
			iconColor: "text-muted-foreground animate-spin",
			accentColor: "text-muted-foreground",
			pillBg: "bg-muted",
			isTransient: true,
		};
	}

	if (mergeable === MERGEABLE_STATE.CONFLICTING || mergeStateStatus === MERGE_STATE_STATUS.DIRTY) {
		return {
			status: MERGE_STATUS.CONFLICTS,
			label: "Conflicts",
			icon: XCircle,
			iconColor: "text-red-500",
			accentColor: "text-red-500",
			pillBg: "bg-red-500/10",
			isTransient: false,
		};
	}

	if (isInMergeQueue && entry) {
		return {
			status: MERGE_STATUS.IN_MERGE_QUEUE,
			label: `In merge queue (#${entry.position})`,
			icon: Loader2,
			iconColor: "text-blue-500 animate-spin",
			accentColor: "text-blue-500",
			pillBg: "bg-blue-500/10",
			isTransient: true,
		};
	}

	// UNSTABLE = non-required checks failing but PR is mergeable. Community tools treat this as ready.
	if (
		mergeStateStatus === MERGE_STATE_STATUS.CLEAN ||
		mergeStateStatus === MERGE_STATE_STATUS.HAS_HOOKS ||
		mergeStateStatus === MERGE_STATE_STATUS.UNSTABLE
	) {
		return {
			status: MERGE_STATUS.READY,
			label: "Ready to merge",
			icon: Check,
			iconColor: "text-green-500",
			accentColor: "text-green-500",
			pillBg: "bg-green-500/10",
			isTransient: false,
		};
	}

	if (mergeStateStatus === MERGE_STATE_STATUS.BEHIND) {
		return {
			status: MERGE_STATUS.BEHIND,
			label: "Behind base branch",
			icon: AlertTriangle,
			iconColor: "text-yellow-500",
			accentColor: "text-yellow-500",
			pillBg: "bg-yellow-500/10",
			isTransient: false,
		};
	}

	return {
		status: MERGE_STATUS.BLOCKED,
		label: "Blocked",
		icon: XCircle,
		iconColor: "text-red-500",
		accentColor: "text-red-500",
		pillBg: "bg-red-500/10",
		isTransient: isChecksPending(info),
	};
}
