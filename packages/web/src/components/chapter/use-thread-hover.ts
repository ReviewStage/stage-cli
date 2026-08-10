import type { SelectedLineRange } from "@pierre/diffs";
import type { LineAnchoredReviewThread, ReviewThread } from "@stagereview/types/review";
import { useCallback, useEffect, useRef, useState } from "react";
import { getThreadHoverRange } from "./thread-hover-range";

/** Keeps Pierre's synthetic selection in sync with the thread currently under the pointer. */
export function useThreadHover(threads: readonly ReviewThread[]) {
	const [hoverLines, setHoverLines] = useState<SelectedLineRange | null>(null);
	const isHoveringRef = useRef(false);
	const hoveredThreadIdRef = useRef<string | null>(null);

	const leave = useCallback((threadId: string) => {
		if (hoveredThreadIdRef.current !== threadId) return;
		hoveredThreadIdRef.current = null;
		isHoveringRef.current = false;
		setHoverLines(null);
	}, []);

	const enter = useCallback((thread: LineAnchoredReviewThread) => {
		hoveredThreadIdRef.current = thread.id;
		isHoveringRef.current = true;
		setHoverLines(getThreadHoverRange(thread));
	}, []);
	const isHovering = useCallback(() => isHoveringRef.current, []);

	useEffect(() => {
		const hoveredThreadId = hoveredThreadIdRef.current;
		if (hoveredThreadId !== null && !threads.some((thread) => thread.id === hoveredThreadId)) {
			leave(hoveredThreadId);
		}
	}, [threads, leave]);

	return { enter, hoverLines, isHovering, leave };
}
