import type { SelectedLineRange } from "@pierre/diffs";
import { type LineAnchoredReviewThread, THREAD_SOURCE } from "@stagereview/types/review";

/** Convert a review anchor into the two-sided range expected by Pierre. */
export function getThreadHoverRange(thread: LineAnchoredReviewThread): SelectedLineRange {
	return {
		start: thread.startLine,
		side: thread.source === THREAD_SOURCE.GITHUB ? thread.startSide : thread.side,
		end: thread.endLine,
		endSide: thread.side,
	};
}
