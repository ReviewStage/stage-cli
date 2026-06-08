import type { SelectedLineRange } from "@pierre/diffs";
import { useCallback, useEffect, useRef, useState } from "react";
import { DIFF_SIDE, type DiffSide } from "@/lib/diff-types";

export interface TextSelectionInfo {
	/** Bounding rect of the browser selection in page (document) coordinates. */
	rect: DOMRect;
	/** Pierre line range derived from the selection. */
	lineRange: SelectedLineRange;
}

interface SelectedLineRangeParams {
	startLine: number;
	endLine: number;
	startSide: DiffSide;
	endSide: DiffSide;
}

/**
 * Builds a Pierre line range from selection endpoints. A comment can't span both
 * diff sides in split view, so cross-side selections return null.
 */
export function buildSelectedLineRange({
	startLine,
	endLine,
	startSide,
	endSide,
}: SelectedLineRangeParams): SelectedLineRange | null {
	if (startSide !== endSide) return null;
	return {
		start: Math.min(startLine, endLine),
		side: startSide,
		end: Math.max(startLine, endLine),
		endSide: startSide,
	};
}

/**
 * Normalizes a Pierre line range so `start <= end`. Pierre's drag-to-select emits
 * `{ start: anchor, end: currentLine }` without ordering them, so dragging upward
 * produces a range where `start > end`. Swap endpoints (and sides) so downstream
 * consumers can rely on ascending order.
 */
export function normalizeSelectedLineRange(range: SelectedLineRange): SelectedLineRange {
	if (range.start <= range.end) return range;
	return {
		start: range.end,
		side: range.endSide ?? range.side,
		end: range.start,
		endSide: range.side,
	};
}

/**
 * Finds the closest ancestor element (including the node itself) with a
 * `data-line` attribute. Does not cross shadow DOM boundaries.
 */
function findLineElement(node: Node): HTMLElement | null {
	let current: Node | null = node;
	while (current) {
		if (current instanceof HTMLElement && current.hasAttribute("data-line")) {
			return current;
		}
		current = current.parentElement;
	}
	return null;
}

/**
 * Determines a line element's diff side from its `data-additions`/`data-deletions`
 * ancestor, falling back to its `data-line-type` for unified/single-sided diffs.
 */
function getLineSide(lineEl: HTMLElement): DiffSide {
	let current: HTMLElement | null = lineEl;
	while (current) {
		if (current.hasAttribute("data-additions")) return DIFF_SIDE.ADDITIONS;
		if (current.hasAttribute("data-deletions")) return DIFF_SIDE.DELETIONS;
		current = current.parentElement;
	}
	const lineType = lineEl.getAttribute("data-line-type");
	if (lineType === "deletion") return DIFF_SIDE.DELETIONS;
	return DIFF_SIDE.ADDITIONS;
}

/** Chrome exposes `getSelection()` on `ShadowRoot` (non-standard); detect it at runtime. */
function hasGetSelection(
	root: ShadowRoot | null,
): root is ShadowRoot & { getSelection: () => Selection | null } {
	return root != null && "getSelection" in root;
}

function getLineNumber(el: HTMLElement): number {
	return Number(el.getAttribute("data-line"));
}

/**
 * Detects native text selection inside a Pierre diff container and converts it to
 * a {@link TextSelectionInfo} (line range + bounding rect). Returns null when
 * there's no active selection in the diff.
 */
export function useTextSelection(containerRef: React.RefObject<HTMLDivElement | null>) {
	const [selectionInfo, setSelectionInfo] = useState<TextSelectionInfo | null>(null);
	const isMouseDownRef = useRef(false);
	const rafIdRef = useRef<number | null>(null);
	const shadowRootRef = useRef<ShadowRoot | null>(null);

	const clearSelection = useCallback(() => {
		setSelectionInfo(null);
		window.getSelection()?.removeAllRanges();
		if (hasGetSelection(shadowRootRef.current)) {
			shadowRootRef.current.getSelection()?.removeAllRanges();
		}
	}, []);

	// Dismiss the popup when the user clicks outside this diff container (e.g.
	// selecting text in another file's diff). The popup is portaled to body, so
	// don't dismiss when the click lands on the popup itself.
	useEffect(() => {
		function handleGlobalMouseDown(e: MouseEvent) {
			const container = containerRef.current;
			if (!container) return;
			if (!(e.target instanceof Node)) return;
			if (container.contains(e.target)) return;
			if (e.target instanceof Element && e.target.closest("[data-text-selection-popup]")) return;
			setSelectionInfo(null);
		}
		document.addEventListener("mousedown", handleGlobalMouseDown, true);
		return () => document.removeEventListener("mousedown", handleGlobalMouseDown, true);
	}, [containerRef]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		// Pierre creates its <diffs-container> shadow root asynchronously (its
		// highlighting is worker-backed), so it may not exist yet when this effect
		// first runs. Resolve it lazily on each event instead of caching a
		// possibly-null value.
		const resolveShadowRoot = (): ShadowRoot | null => {
			const root = container.querySelector("diffs-container")?.shadowRoot ?? null;
			shadowRootRef.current = root;
			return root;
		};

		const handleMouseDown = () => {
			isMouseDownRef.current = true;
			if (rafIdRef.current !== null) {
				cancelAnimationFrame(rafIdRef.current);
				rafIdRef.current = null;
			}
			setSelectionInfo(null);
		};

		const handleMouseUp = () => {
			if (!isMouseDownRef.current) return;
			isMouseDownRef.current = false;

			// Defer a frame so the browser finalizes the selection first.
			if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
			rafIdRef.current = requestAnimationFrame(() => {
				rafIdRef.current = null;
				const shadowRoot = resolveShadowRoot();
				const selection = hasGetSelection(shadowRoot)
					? shadowRoot.getSelection()
					: window.getSelection();
				if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

				const range = selection.getRangeAt(0);
				const startLineEl = findLineElement(range.startContainer);
				const endLineEl = findLineElement(range.endContainer);
				if (!startLineEl || !endLineEl) return;

				// Confirm the selection is within our diff container, walking up through
				// any shadow DOM hosts.
				let ancestor: Node | null = startLineEl;
				let insideContainer = false;
				while (ancestor) {
					if (ancestor === container) {
						insideContainer = true;
						break;
					}
					ancestor = ancestor instanceof ShadowRoot ? ancestor.host : ancestor.parentNode;
				}
				if (!insideContainer) return;

				const startLine = getLineNumber(startLineEl);
				let endLine = getLineNumber(endLineEl);
				const startSide = getLineSide(startLineEl);
				let endSide = getLineSide(endLineEl);

				// Triple-click selects a full line but the browser extends the range to
				// offset 0 of the next line. Pull the end back to the line with content.
				const isTripleClick = endLine > startLine && range.endOffset === 0;
				if (isTripleClick) {
					endLine--;
					if (endLine === startLine) {
						endSide = startSide;
					} else {
						const sideContainer =
							endLineEl.closest("[data-additions], [data-deletions]") ?? shadowRoot ?? container;
						const adjustedEl = sideContainer.querySelector<HTMLElement>(`[data-line="${endLine}"]`);
						if (adjustedEl) endSide = getLineSide(adjustedEl);
					}
				}

				// getClientRects() yields tight bounds around the selected text. Multi-line
				// selections also include full-width block rects (from the line <div>s);
				// filter those so only inline text fragments contribute. For triple-click,
				// clamp to the start line so the next line's rects don't skew bounds.
				const rectRange = isTripleClick ? range.cloneRange() : range;
				if (isTripleClick) rectRange.setEndAfter(startLineEl);
				const lineWidth = startLineEl.getBoundingClientRect().width;
				const clientRects = rectRange.getClientRects();
				let left = Infinity;
				let right = -Infinity;
				let top = Infinity;
				let bottom = -Infinity;
				for (const r of clientRects) {
					if (r.width === 0 && r.height === 0) continue;
					if (Math.abs(r.width - lineWidth) < 1) continue;
					left = Math.min(left, r.left);
					right = Math.max(right, r.right);
					top = Math.min(top, r.top);
					bottom = Math.max(bottom, r.bottom);
				}
				if (!Number.isFinite(left)) {
					const rangeRect = range.getBoundingClientRect();
					left = rangeRect.left;
					right = rangeRect.right;
					top = rangeRect.top;
					bottom = rangeRect.bottom;
				}

				const rect = new DOMRect(
					left + window.scrollX,
					top + window.scrollY,
					right - left,
					bottom - top,
				);

				const lineRange = buildSelectedLineRange({ startLine, endLine, startSide, endSide });
				if (!lineRange) return;
				setSelectionInfo({ rect, lineRange });
			});
		};

		container.addEventListener("mousedown", handleMouseDown, true);
		container.addEventListener("mouseup", handleMouseUp, true);

		// Bind directly on the shadow root as soon as it appears. Pierre may not
		// have created it yet, so poll a bounded number of frames; the container
		// capture listeners above are the fallback until it does.
		let boundShadowRoot: ShadowRoot | null = null;
		let pollFrame: number | null = null;
		let framesLeft = 120;
		const bindShadowRoot = () => {
			pollFrame = null;
			const root = resolveShadowRoot();
			if (root) {
				boundShadowRoot = root;
				root.addEventListener("mousedown", handleMouseDown, true);
				root.addEventListener("mouseup", handleMouseUp, true);
			} else if (framesLeft-- > 0) {
				pollFrame = requestAnimationFrame(bindShadowRoot);
			}
		};
		bindShadowRoot();

		return () => {
			if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
			if (pollFrame !== null) cancelAnimationFrame(pollFrame);
			container.removeEventListener("mousedown", handleMouseDown, true);
			container.removeEventListener("mouseup", handleMouseUp, true);
			if (boundShadowRoot) {
				boundShadowRoot.removeEventListener("mousedown", handleMouseDown, true);
				boundShadowRoot.removeEventListener("mouseup", handleMouseUp, true);
			}
		};
	}, [containerRef]);

	return { selectionInfo, clearSelection };
}
