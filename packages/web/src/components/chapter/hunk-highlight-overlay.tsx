import type * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { AnnotatedLineRef, LineRef } from "@/lib/diff-types";
import { findRenderedDiffLine } from "./rendered-line-target";

interface HighlightBox {
	top: number;
	left: number;
	width: number;
	height: number;
	firstLineHeight: number;
}

interface LineRefIdentity {
	keyChangeId: string;
	filePath: string;
	side: LineRef["side"];
	startLine: number;
	endLine: number;
}

interface InteractiveHighlightBox extends HighlightBox, LineRefIdentity {
	isChecked: boolean;
}

interface MeasuredRef {
	ref: LineRef;
	box: HighlightBox | null;
}

const SHADOW_ROOT_POLL_MS = 100;
const SHADOW_ROOT_POLL_MAX_MS = 3000;

function findShadowRoot(container: HTMLElement): ShadowRoot | null {
	const diffsContainer = container.querySelector("diffs-container");
	return diffsContainer?.shadowRoot ?? null;
}

function findScrollSurface(shadowRoot: ShadowRoot): HTMLElement | null {
	return shadowRoot.querySelector<HTMLElement>("pre");
}

function findFirstVisibleLine(
	shadowRoot: ShadowRoot,
	side: LineRef["side"],
	startLine: number,
	endLine: number,
): HTMLElement | null {
	for (let line = startLine; line <= endLine; line++) {
		const el = findRenderedDiffLine(shadowRoot, side, line);
		if (el) return el;
	}
	return null;
}

function findLastVisibleLine(
	shadowRoot: ShadowRoot,
	side: LineRef["side"],
	startLine: number,
	endLine: number,
): HTMLElement | null {
	for (let line = endLine; line >= startLine; line--) {
		const el = findRenderedDiffLine(shadowRoot, side, line);
		if (el) return el;
	}
	return null;
}

function findLineRow(lineEl: HTMLElement): HTMLElement {
	if (lineEl.hasAttribute("data-line")) return lineEl;
	return lineEl.closest<HTMLElement>("[data-line]") ?? lineEl;
}

function findLineNumberElement(row: HTMLElement): HTMLElement | null {
	const nested = row.querySelector<HTMLElement>("[data-column-number]");
	if (nested) return nested;

	const lineIndex = row.getAttribute("data-line-index");
	if (!lineIndex) return null;

	const scope = row.closest<HTMLElement>("[data-additions], [data-deletions], [data-unified]");
	const root = scope ?? row.getRootNode();
	if (!(root instanceof Document || root instanceof ShadowRoot || root instanceof HTMLElement)) {
		return null;
	}
	return root.querySelector<HTMLElement>(`[data-column-number][data-line-index="${lineIndex}"]`);
}

export function getHighlightLineRect(lineEl: HTMLElement): DOMRect {
	const row = findLineRow(lineEl);
	const rowRect = row.getBoundingClientRect();
	const numberRect = findLineNumberElement(row)?.getBoundingClientRect();
	const contentRect =
		row.querySelector<HTMLElement>("[data-column-content]")?.getBoundingClientRect() ?? rowRect;

	if (!numberRect || !contentRect) return rowRect;

	const left = Math.min(numberRect.left, contentRect.left);
	const right = Math.max(numberRect.right, contentRect.right);

	return DOMRect.fromRect({
		x: left,
		y: rowRect.top,
		width: right - left,
		height: rowRect.height,
	});
}

/**
 * `getBoundingClientRect()` returns the container's border-box, but
 * `position: absolute` measures from the padding edge — subtract
 * `clientLeft`/`clientTop` (border widths) so boxes align with the lines
 * they track instead of shifting by the container's border width.
 */
function measureLineRange(
	shadowRoot: ShadowRoot,
	lineRef: LineRef,
	container: HTMLElement,
	containerRect: DOMRect,
): HighlightBox | null {
	const firstEl = findFirstVisibleLine(
		shadowRoot,
		lineRef.side,
		lineRef.startLine,
		lineRef.endLine,
	);
	const lastEl = findLastVisibleLine(shadowRoot, lineRef.side, lineRef.startLine, lineRef.endLine);
	if (!firstEl || !lastEl) return null;

	const firstRow = findLineRow(firstEl);
	const lastRow = findLineRow(lastEl);
	const firstRect = getHighlightLineRect(firstRow);
	const lastRect = getHighlightLineRect(lastRow);
	let bottom = lastRect.bottom;
	let trailingAnnotation = lastRow.nextElementSibling;

	while (
		trailingAnnotation instanceof HTMLElement &&
		trailingAnnotation.hasAttribute("data-line-annotation")
	) {
		bottom = trailingAnnotation.getBoundingClientRect().bottom;
		trailingAnnotation = trailingAnnotation.nextElementSibling;
	}

	const paddingBoxLeft = containerRect.left + container.clientLeft;
	const paddingBoxTop = containerRect.top + container.clientTop;

	return {
		top: firstRect.top - paddingBoxTop,
		left: firstRect.left - paddingBoxLeft,
		width: firstRect.width,
		height: bottom - firstRect.top,
		firstLineHeight: firstRect.height,
	};
}

/**
 * Matching by coordinates (not object identity) preserves prior measurements
 * even when the parent recreates LineRef objects between renders, while still
 * avoiding the index-aliasing bugs you'd get from matching by array position.
 */
function measureAll(
	refs: readonly LineRef[],
	container: HTMLElement,
	prev: readonly MeasuredRef[],
): MeasuredRef[] {
	const shadowRoot = findShadowRoot(container);
	const containerRect = container.getBoundingClientRect();
	return refs.map((ref) => {
		const measured = shadowRoot
			? measureLineRange(shadowRoot, ref, container, containerRect)
			: null;
		if (measured) return { ref, box: measured };
		const prevBox =
			prev.find(
				(p) =>
					p.ref.filePath === ref.filePath &&
					p.ref.side === ref.side &&
					p.ref.startLine === ref.startLine &&
					p.ref.endLine === ref.endLine,
			)?.box ?? null;
		return { ref, box: prevBox };
	});
}

function hasActiveTextSelection(
	selection: Pick<Selection, "isCollapsed" | "toString"> | null,
): boolean {
	return selection != null && !selection.isCollapsed && selection.toString().trim().length > 0;
}

function hasGetSelection(
	root: ShadowRoot | null,
): root is ShadowRoot & { getSelection: () => Selection | null } {
	return root != null && "getSelection" in root;
}

export function shouldIgnoreOverlayClick(
	path: EventTarget[],
	selection: Pick<Selection, "isCollapsed" | "toString"> | null,
): boolean {
	if (hasActiveTextSelection(selection)) return true;

	for (const target of path) {
		if (!(target instanceof HTMLElement)) continue;
		if (
			target.matches(
				[
					"button",
					"a",
					"input",
					"textarea",
					"select",
					"label",
					"summary",
					"[role='button']",
					"[role='checkbox']",
					"[role='link']",
					"[contenteditable='true']",
					"[data-line-annotation]",
					"[data-annotation-content]",
					"[data-hover-slot]",
					"[data-expand-button]",
				].join(", "),
			)
		) {
			return true;
		}
	}

	return false;
}

function pointIntersectsBox(x: number, y: number, box: HighlightBox): boolean {
	return x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height;
}

export function findKeyChangeIdAtPoint(
	x: number,
	y: number,
	boxes: InteractiveHighlightBox[],
): string | null {
	for (let i = boxes.length - 1; i >= 0; i--) {
		const box = boxes[i];
		if (box && pointIntersectsBox(x, y, box)) return box.keyChangeId;
	}
	return null;
}

function findInteractiveBoxAtPoint(
	x: number,
	y: number,
	focusedBoxes: InteractiveHighlightBox[],
	allBoxes: InteractiveHighlightBox[],
): InteractiveHighlightBox | null {
	for (let i = focusedBoxes.length - 1; i >= 0; i--) {
		const box = focusedBoxes[i];
		if (box && pointIntersectsBox(x, y, box)) return box;
	}

	for (let i = allBoxes.length - 1; i >= 0; i--) {
		const box = allBoxes[i];
		if (box && pointIntersectsBox(x, y, box)) return box;
	}

	return null;
}

export function isPointInReviewStateBadge(
	x: number,
	y: number,
	badgeRect: Pick<DOMRect, "top" | "left" | "width" | "height">,
	containerRect: Pick<DOMRect, "top" | "left">,
): boolean {
	const badgeLeft = badgeRect.left - containerRect.left;
	const badgeTop = badgeRect.top - containerRect.top;

	return (
		x >= badgeLeft &&
		x <= badgeLeft + badgeRect.width &&
		y >= badgeTop &&
		y <= badgeTop + badgeRect.height
	);
}

function identityMatches(a: LineRefIdentity, b: LineRefIdentity): boolean {
	return (
		a.keyChangeId === b.keyChangeId &&
		a.filePath === b.filePath &&
		a.side === b.side &&
		a.startLine === b.startLine &&
		a.endLine === b.endLine
	);
}

interface BadgeRefEntry extends LineRefIdentity {
	node: HTMLDivElement;
}

function ReviewStateBadge({
	isChecked,
	keyChangeId,
	filePath,
	side,
	startLine,
	endLine,
	badgeRefs,
}: {
	isChecked: boolean;
	keyChangeId: string;
	filePath: string;
	side: LineRef["side"];
	startLine: number;
	endLine: number;
	badgeRefs: React.MutableRefObject<BadgeRefEntry[]>;
}) {
	const nodeRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const node = nodeRef.current;
		if (!node) return;
		const entries = badgeRefs.current;
		const entry: BadgeRefEntry = { keyChangeId, filePath, side, startLine, endLine, node };
		entries.push(entry);
		return () => {
			const idx = entries.indexOf(entry);
			if (idx >= 0) entries.splice(idx, 1);
		};
	}, [badgeRefs, keyChangeId, filePath, side, startLine, endLine]);

	return (
		<div className="pointer-events-none absolute inset-0 flex justify-end px-1.5">
			<div className="flex h-full items-start justify-center">
				<div ref={nodeRef} className="pointer-events-none">
					<Checkbox
						checked={isChecked}
						aria-hidden="true"
						tabIndex={-1}
						className="pointer-events-none shadow-none"
					/>
				</div>
			</div>
		</div>
	);
}

interface LineHighlightOverlayProps {
	allLineRefs: AnnotatedLineRef[] | undefined;
	focusedLineRefs: LineRef[] | undefined;
	focusedKeyChangeId: string | null;
	isKeyChangeChecked: (keyChangeId: string) => boolean;
	onMarkKeyChangeChecked: (keyChangeId: string) => void;
	onUnmarkKeyChangeChecked: (keyChangeId: string) => void;
	onFocusKeyChange: (keyChangeId: string | null, scrollTarget?: LineRef | null) => void;
	containerRef: React.RefObject<HTMLDivElement | null>;
}

export function LineHighlightOverlay({
	allLineRefs,
	focusedLineRefs,
	focusedKeyChangeId,
	isKeyChangeChecked,
	onMarkKeyChangeChecked,
	onUnmarkKeyChangeChecked,
	onFocusKeyChange,
	containerRef,
}: LineHighlightOverlayProps) {
	const [allMeasurements, setAllMeasurements] = useState<MeasuredRef[]>([]);
	const [focusedMeasurements, setFocusedMeasurements] = useState<MeasuredRef[]>([]);
	const prevAllRef = useRef<MeasuredRef[]>([]);
	const prevFocusedRef = useRef<MeasuredRef[]>([]);
	const badgeRefs = useRef<BadgeRefEntry[]>([]);
	const rafRef = useRef<number | null>(null);

	const measure = useCallback(() => {
		const container = containerRef.current;
		if (!container) return;

		if (allLineRefs && allLineRefs.length > 0) {
			const next = measureAll(allLineRefs, container, prevAllRef.current);
			prevAllRef.current = next;
			setAllMeasurements(next);
		} else {
			prevAllRef.current = [];
			setAllMeasurements([]);
		}

		if (focusedLineRefs && focusedLineRefs.length > 0) {
			const next = measureAll(focusedLineRefs, container, prevFocusedRef.current);
			prevFocusedRef.current = next;
			setFocusedMeasurements(next);
		} else {
			prevFocusedRef.current = [];
			setFocusedMeasurements([]);
		}
	}, [allLineRefs, focusedLineRefs, containerRef]);

	useEffect(() => {
		const container = containerRef.current;
		const hasRefs =
			(allLineRefs && allLineRefs.length > 0) || (focusedLineRefs && focusedLineRefs.length > 0);
		if (!container || !hasRefs) return;

		const scheduleMeasure = () => {
			if (rafRef.current) cancelAnimationFrame(rafRef.current);
			rafRef.current = requestAnimationFrame(measure);
		};

		const initialTimer = setTimeout(measure, 50);

		const resizeObserver = new ResizeObserver(scheduleMeasure);
		resizeObserver.observe(container);

		let shadowMutationObserver: MutationObserver | null = null;
		let scrollSurface: HTMLElement | null = null;

		// Pierre renders with overflow:scroll when line-wrap is off. Horizontal
		// scrolling inside the shadow DOM moves line positions relative to the
		// viewport without firing resize or mutation events, so the overlay
		// must listen for scroll to keep boxes aligned with their lines.
		const syncScrollSurface = (shadowRoot: ShadowRoot) => {
			const next = findScrollSurface(shadowRoot);
			if (next === scrollSurface) return;
			scrollSurface?.removeEventListener("scroll", scheduleMeasure);
			scrollSurface = next;
			scrollSurface?.addEventListener("scroll", scheduleMeasure, { passive: true });
		};

		const attachShadowListeners = (shadowRoot: ShadowRoot) => {
			shadowMutationObserver?.disconnect();
			shadowMutationObserver = new MutationObserver(() => {
				syncScrollSurface(shadowRoot);
				scheduleMeasure();
			});
			shadowMutationObserver.observe(shadowRoot, { childList: true, subtree: true });
			syncScrollSurface(shadowRoot);
		};

		const initialShadowRoot = findShadowRoot(container);
		let retryTimer: ReturnType<typeof setInterval> | null = null;

		if (initialShadowRoot) {
			attachShadowListeners(initialShadowRoot);
		} else {
			const maxAttempts = Math.ceil(SHADOW_ROOT_POLL_MAX_MS / SHADOW_ROOT_POLL_MS);
			let attempts = 0;
			retryTimer = setInterval(() => {
				attempts += 1;
				const shadowRoot = findShadowRoot(container);
				if (shadowRoot) {
					if (retryTimer) clearInterval(retryTimer);
					retryTimer = null;
					attachShadowListeners(shadowRoot);
					measure();
					return;
				}
				if (attempts >= maxAttempts) {
					if (retryTimer) clearInterval(retryTimer);
					retryTimer = null;
				}
			}, SHADOW_ROOT_POLL_MS);
		}

		return () => {
			clearTimeout(initialTimer);
			if (retryTimer) clearInterval(retryTimer);
			if (rafRef.current) cancelAnimationFrame(rafRef.current);
			resizeObserver.disconnect();
			shadowMutationObserver?.disconnect();
			scrollSurface?.removeEventListener("scroll", scheduleMeasure);
		};
	}, [allLineRefs, focusedLineRefs, containerRef, measure]);

	// Look up boxes by ref identity (not array index) so a refs-array change
	// that lands a render before the next measurement cycle can't pair a stale
	// box with a different ref.
	const allBoxByRef = useMemo(() => {
		const map = new Map<LineRef, HighlightBox | null>();
		for (const m of allMeasurements) map.set(m.ref, m.box);
		return map;
	}, [allMeasurements]);

	const focusedBoxByRef = useMemo(() => {
		const map = new Map<LineRef, HighlightBox | null>();
		for (const m of focusedMeasurements) map.set(m.ref, m.box);
		return map;
	}, [focusedMeasurements]);

	const allInteractiveBoxes = useMemo<InteractiveHighlightBox[]>(
		() =>
			allLineRefs?.flatMap((ref) => {
				const box = allBoxByRef.get(ref);
				if (!box || ref.keyChangeId === focusedKeyChangeId) return [];
				return [
					{
						...box,
						keyChangeId: ref.keyChangeId,
						filePath: ref.filePath,
						side: ref.side,
						startLine: ref.startLine,
						endLine: ref.endLine,
						isChecked: isKeyChangeChecked(ref.keyChangeId),
					},
				];
			}) ?? [],
		[allBoxByRef, allLineRefs, focusedKeyChangeId, isKeyChangeChecked],
	);

	const focusedInteractiveBoxes = useMemo<InteractiveHighlightBox[]>(
		() =>
			focusedLineRefs?.flatMap((ref) => {
				const box = focusedBoxByRef.get(ref);
				if (!box || !focusedKeyChangeId) return [];
				return [
					{
						...box,
						keyChangeId: focusedKeyChangeId,
						filePath: ref.filePath,
						side: ref.side,
						startLine: ref.startLine,
						endLine: ref.endLine,
						isChecked: isKeyChangeChecked(focusedKeyChangeId),
					},
				];
			}) ?? [],
		[focusedBoxByRef, focusedKeyChangeId, focusedLineRefs, isKeyChangeChecked],
	);

	// Keep interactive-box state and callbacks in a ref so the click/move effect
	// doesn't tear down and reattach listeners (or re-poll the shadow root) on
	// every measurement update — measurements fire on scroll, which would
	// otherwise churn the effect every rAF.
	const handlerStateRef = useRef({
		allInteractiveBoxes,
		focusedInteractiveBoxes,
		focusedKeyChangeId,
		onFocusKeyChange,
		isKeyChangeChecked,
		onMarkKeyChangeChecked,
		onUnmarkKeyChangeChecked,
	});
	handlerStateRef.current = {
		allInteractiveBoxes,
		focusedInteractiveBoxes,
		focusedKeyChangeId,
		onFocusKeyChange,
		isKeyChangeChecked,
		onMarkKeyChangeChecked,
		onUnmarkKeyChangeChecked,
	};

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const setInteractiveCursor = (shadowRoot: ShadowRoot | null, isPointer: boolean) => {
			const interactiveSurface = shadowRoot?.querySelector<HTMLElement>("pre") ?? container;
			interactiveSurface.style.cursor = isPointer ? "pointer" : "";
		};

		const handleClick = (event: Event, shadowRoot: ShadowRoot | null) => {
			if (!(event instanceof MouseEvent)) return;
			if (event.defaultPrevented || event.button !== 0) return;
			if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

			const selection = hasGetSelection(shadowRoot)
				? shadowRoot.getSelection()
				: window.getSelection();
			if (shouldIgnoreOverlayClick(event.composedPath(), selection)) return;

			const state = handlerStateRef.current;
			const containerRect = container.getBoundingClientRect();
			const x = event.clientX - containerRect.left;
			const y = event.clientY - containerRect.top;
			const box = findInteractiveBoxAtPoint(
				x,
				y,
				state.focusedInteractiveBoxes,
				state.allInteractiveBoxes,
			);
			if (!box) return;

			const badge = badgeRefs.current.find((entry) => identityMatches(entry, box));
			if (
				badge &&
				isPointInReviewStateBadge(x, y, badge.node.getBoundingClientRect(), containerRect)
			) {
				if (state.isKeyChangeChecked(box.keyChangeId)) {
					state.onUnmarkKeyChangeChecked(box.keyChangeId);
				} else {
					state.onMarkKeyChangeChecked(box.keyChangeId);
				}
				return;
			}

			// Toggle off when clicking any box of the already-focused key change so
			// users can clear focus from the diff surface.
			if (box.keyChangeId === state.focusedKeyChangeId) {
				state.onFocusKeyChange(null);
				return;
			}
			state.onFocusKeyChange(box.keyChangeId, {
				filePath: box.filePath,
				side: box.side,
				startLine: box.startLine,
				endLine: box.endLine,
			});
		};

		const handlePointerMove = (event: Event, shadowRoot: ShadowRoot | null) => {
			if (!(event instanceof MouseEvent)) return;
			if (shouldIgnoreOverlayClick(event.composedPath(), null)) {
				setInteractiveCursor(shadowRoot, false);
				return;
			}

			const state = handlerStateRef.current;
			const containerRect = container.getBoundingClientRect();
			const x = event.clientX - containerRect.left;
			const y = event.clientY - containerRect.top;
			setInteractiveCursor(
				shadowRoot,
				findInteractiveBoxAtPoint(x, y, state.focusedInteractiveBoxes, state.allInteractiveBoxes) !=
					null,
			);
		};

		let retryTimer: ReturnType<typeof setInterval> | undefined;
		let cleanupShadowClickListener: (() => void) | undefined;

		const attachListeners = (shadowRoot: ShadowRoot | null) => {
			const onShadowClick: EventListener = (event) => handleClick(event, shadowRoot);
			const onContainerClick: EventListener = (event) => handleClick(event, shadowRoot);
			const onShadowMove: EventListener = (event) => handlePointerMove(event, shadowRoot);
			const onContainerMove: EventListener = (event) => handlePointerMove(event, shadowRoot);
			const onShadowLeave: EventListener = () => setInteractiveCursor(shadowRoot, false);
			const onContainerLeave: EventListener = () => setInteractiveCursor(shadowRoot, false);

			if (shadowRoot) {
				shadowRoot.addEventListener("click", onShadowClick, true);
				shadowRoot.addEventListener("pointermove", onShadowMove, true);
				shadowRoot.addEventListener("pointerleave", onShadowLeave, true);
			} else {
				container.addEventListener("click", onContainerClick, true);
				container.addEventListener("pointermove", onContainerMove, true);
				container.addEventListener("pointerleave", onContainerLeave, true);
			}

			cleanupShadowClickListener = () => {
				if (shadowRoot) {
					setInteractiveCursor(shadowRoot, false);
					shadowRoot.removeEventListener("click", onShadowClick, true);
					shadowRoot.removeEventListener("pointermove", onShadowMove, true);
					shadowRoot.removeEventListener("pointerleave", onShadowLeave, true);
				} else {
					setInteractiveCursor(shadowRoot, false);
					container.removeEventListener("click", onContainerClick, true);
					container.removeEventListener("pointermove", onContainerMove, true);
					container.removeEventListener("pointerleave", onContainerLeave, true);
				}
			};
		};

		const initialShadowRoot = findShadowRoot(container);
		attachListeners(initialShadowRoot);

		if (!initialShadowRoot) {
			const maxAttempts = Math.ceil(SHADOW_ROOT_POLL_MAX_MS / SHADOW_ROOT_POLL_MS);
			let attempts = 0;
			retryTimer = setInterval(() => {
				attempts += 1;
				const shadowRoot = findShadowRoot(container);
				if (shadowRoot) {
					clearInterval(retryTimer);
					cleanupShadowClickListener?.();
					attachListeners(shadowRoot);
					return;
				}
				if (attempts >= maxAttempts) {
					clearInterval(retryTimer);
				}
			}, SHADOW_ROOT_POLL_MS);
		}

		return () => {
			clearInterval(retryTimer);
			cleanupShadowClickListener?.();
		};
	}, [containerRef]);

	const hasAllBoxes = allLineRefs && allMeasurements.some((m) => m.box !== null);
	const hasFocusedBoxes = focusedLineRefs && focusedMeasurements.some((m) => m.box !== null);

	if (!hasAllBoxes && !hasFocusedBoxes) return null;

	return (
		<>
			{/* Subtle boxes for all key change line refs (always visible) */}
			{allLineRefs?.map((ref) => {
				const box = allBoxByRef.get(ref);
				if (!box) return null;
				// Skip subtle box for focused key change — the focused layer renders those
				if (ref.keyChangeId === focusedKeyChangeId) return null;
				return (
					<div
						key={`all-${ref.keyChangeId}-${ref.side}-${ref.startLine}-${ref.endLine}`}
						className="contents"
					>
						<div
							className="pointer-events-none absolute z-[2] rounded-sm"
							style={{
								top: box.top,
								left: box.left,
								width: box.width,
								height: box.height,
								backgroundColor: "var(--hunk-highlight-bg)",
								border: "1.5px solid var(--hunk-highlight-border)",
							}}
						/>
						<div
							className="pointer-events-none absolute z-[3]"
							style={{
								top: box.top,
								left: box.left,
								width: box.width,
								height: box.firstLineHeight,
							}}
						>
							<ReviewStateBadge
								isChecked={isKeyChangeChecked(ref.keyChangeId)}
								keyChangeId={ref.keyChangeId}
								filePath={ref.filePath}
								side={ref.side}
								startLine={ref.startLine}
								endLine={ref.endLine}
								badgeRefs={badgeRefs}
							/>
						</div>
					</div>
				);
			})}

			{/* Bold boxes for the focused key change */}
			{focusedLineRefs?.map((ref) => {
				const box = focusedBoxByRef.get(ref);
				if (!box || !focusedKeyChangeId) return null;
				return (
					<div
						key={`focused-${focusedKeyChangeId}-${ref.side}-${ref.startLine}-${ref.endLine}`}
						className="contents"
					>
						<div
							className="pointer-events-none absolute z-[2] rounded-sm"
							style={{
								top: box.top,
								left: box.left,
								width: box.width,
								height: box.height,
								backgroundColor: "var(--hunk-highlight-focused-bg)",
								border: "2px solid var(--hunk-highlight-focused-border)",
							}}
						/>
						<div
							className="pointer-events-none absolute z-[3]"
							style={{
								top: box.top,
								left: box.left,
								width: box.width,
								height: box.firstLineHeight,
							}}
						>
							<ReviewStateBadge
								isChecked={isKeyChangeChecked(focusedKeyChangeId)}
								keyChangeId={focusedKeyChangeId}
								filePath={ref.filePath}
								side={ref.side}
								startLine={ref.startLine}
								endLine={ref.endLine}
								badgeRefs={badgeRefs}
							/>
						</div>
					</div>
				);
			})}
		</>
	);
}
