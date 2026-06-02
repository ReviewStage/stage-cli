import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

/**
 * Which edge the drag handle sits on. A handle on the LEFT edge belongs to a
 * right-docked panel, so the panel grows as the pointer moves left; a handle on
 * the RIGHT edge belongs to a left-docked panel and grows as it moves right.
 */
export const RESIZE_HANDLE_SIDE = {
	LEFT: "left",
	RIGHT: "right",
} as const;

export type ResizeHandleSide = (typeof RESIZE_HANDLE_SIDE)[keyof typeof RESIZE_HANDLE_SIDE];

/** A width bound: a fixed pixel value, or one derived from the viewport width. */
type WidthBound = number | ((viewportWidth: number) => number);

/**
 * Viewport width assumed during SSR and the first client render. Keeping it
 * deterministic avoids a hydration mismatch for viewport-relative bounds; a
 * mount effect then re-resolves against the real viewport.
 */
const SSR_VIEWPORT_WIDTH = 1440;

function viewportWidth(): number {
	return typeof window === "undefined" ? SSR_VIEWPORT_WIDTH : window.innerWidth;
}

function resolveBound(bound: WidthBound, vw: number): number {
	return typeof bound === "function" ? bound(vw) : bound;
}

interface UseResizablePanelOptions {
	minWidth: WidthBound;
	maxWidth: WidthBound;
	defaultWidth: WidthBound;
	/** Edge the drag handle sits on. Defaults to the right edge (left-docked panel). */
	handleSide?: ResizeHandleSide;
	/**
	 * Controlled width. Provide together with `onWidthChange` to source and
	 * persist the width externally (e.g. a store). Omit for self-managed state
	 * that resets to the default on mount.
	 */
	width?: number;
	onWidthChange?: (width: number) => void;
	/**
	 * Whether the panel is currently in its resizable state. Pass `false` for a
	 * panel that stays mounted while hidden (e.g. a collapsed-to-zero-width chat
	 * panel) so an in-flight drag aborts instead of forcing the hidden panel back
	 * open. Defaults to `true`.
	 */
	enabled?: boolean;
}

interface UseResizablePanelResult<T extends HTMLElement> {
	/** Current width in pixels, always within the configured bounds. */
	width: number;
	/** Attach to the element whose width is being controlled. */
	panelRef: RefObject<T | null>;
	/** Spread onto the drag handle element. */
	resizeHandleProps: {
		onMouseDown: (event: React.MouseEvent) => void;
		onDoubleClick: () => void;
	};
}

/**
 * Drives a horizontally resizable panel: pointer-drag resizing, double-click to
 * restore the default width, and clamping to min/max bounds. Bounds may be fixed
 * pixels or functions of the live viewport width.
 *
 * During a drag the width is written straight to the element's inline style via
 * requestAnimationFrame, so heavy panel contents don't re-render on every mouse
 * move; the committed width is pushed to React state (or `onWidthChange`) only
 * on release.
 */
export function useResizablePanel<T extends HTMLElement = HTMLDivElement>({
	minWidth,
	maxWidth,
	defaultWidth,
	handleSide = RESIZE_HANDLE_SIDE.RIGHT,
	width: controlledWidth,
	onWidthChange,
	enabled = true,
}: UseResizablePanelOptions): UseResizablePanelResult<T> {
	const panelRef = useRef<T>(null);
	const isControlled = controlledWidth !== undefined;

	// Read inside drag handlers so a toggle mid-drag is seen by the live drag.
	const enabledRef = useRef(enabled);
	enabledRef.current = enabled;

	const clamp = useCallback(
		(value: number) => {
			const vw = viewportWidth();
			return Math.min(resolveBound(maxWidth, vw), Math.max(resolveBound(minWidth, vw), value));
		},
		[minWidth, maxWidth],
	);

	const resolveDefault = useCallback(
		() => clamp(resolveBound(defaultWidth, viewportWidth())),
		[clamp, defaultWidth],
	);

	// Deterministic initial value (SSR viewport) so server and first client
	// render agree; the mount effect below re-resolves against the real viewport.
	const [uncontrolledWidth, setUncontrolledWidth] = useState(() => {
		const vw = SSR_VIEWPORT_WIDTH;
		return Math.min(
			resolveBound(maxWidth, vw),
			Math.max(resolveBound(minWidth, vw), resolveBound(defaultWidth, vw)),
		);
	});

	useEffect(() => {
		if (isControlled) return;
		setUncontrolledWidth(resolveDefault());
	}, [isControlled, resolveDefault]);

	const commitWidth = useCallback(
		(value: number) => {
			const clamped = clamp(value);
			if (isControlled) {
				onWidthChange?.(clamped);
			} else {
				setUncontrolledWidth(clamped);
			}
		},
		[clamp, isControlled, onWidthChange],
	);

	const rafId = useRef(0);
	const latestWidth = useRef(0);
	const cleanupRef = useRef<(() => void) | null>(null);

	const onMouseDown = useCallback(
		(event: React.MouseEvent) => {
			if (!enabledRef.current) return;
			event.preventDefault();
			const panel = panelRef.current;
			if (!panel) return;

			const direction = handleSide === RESIZE_HANDLE_SIDE.LEFT ? -1 : 1;
			const startX = event.clientX;
			const startWidth = panel.offsetWidth;
			latestWidth.current = startWidth;

			// Detach listeners and restore page chrome, without committing a width.
			const detach = () => {
				cancelAnimationFrame(rafId.current);
				document.removeEventListener("mousemove", handleMouseMove);
				document.removeEventListener("mouseup", handleMouseUp);
				document.body.style.cursor = "";
				document.body.style.userSelect = "";
				cleanupRef.current = null;
			};

			const handleMouseMove = (moveEvent: MouseEvent) => {
				// The panel was hidden mid-drag (e.g. the chat panel was toggled
				// closed): stop driving its width and let it return to its resting
				// layout instead of holding it open at the dragged width.
				if (!enabledRef.current) {
					detach();
					panel.style.removeProperty("transition");
					return;
				}
				// Compute the width synchronously so a mouseup landing before the next
				// animation frame still commits the pointer's real release position;
				// the rAF only batches the heavier DOM write.
				const next = clamp(startWidth + (moveEvent.clientX - startX) * direction);
				latestWidth.current = next;
				cancelAnimationFrame(rafId.current);
				rafId.current = requestAnimationFrame(() => {
					if (!enabledRef.current) return;
					panel.style.width = `${next}px`;
				});
			};

			const handleMouseUp = () => {
				const wasEnabled = enabledRef.current;
				detach();
				// The panel was hidden mid-drag: drop it, restore the transition, and
				// don't apply or commit a width.
				if (!wasEnabled) {
					panel.style.removeProperty("transition");
					return;
				}
				// Apply the final width while the transition is still suppressed (from
				// mousedown) so a cancelled last frame doesn't animate the panel from a
				// stale width, then restore the transition for open/close animations.
				panel.style.width = `${latestWidth.current}px`;
				panel.style.removeProperty("transition");
				commitWidth(latestWidth.current);
			};

			document.addEventListener("mousemove", handleMouseMove);
			document.addEventListener("mouseup", handleMouseUp);
			document.body.style.cursor = "col-resize";
			document.body.style.userSelect = "none";
			// Disable any width transition so dragging tracks the pointer 1:1.
			panel.style.transition = "none";
			cleanupRef.current = detach;
		},
		[handleSide, clamp, commitWidth],
	);

	const onDoubleClick = useCallback(() => {
		if (!enabledRef.current) return;
		commitWidth(resolveDefault());
	}, [commitWidth, resolveDefault]);

	useEffect(
		() => () => {
			cleanupRef.current?.();
			cancelAnimationFrame(rafId.current);
		},
		[],
	);

	const width = isControlled ? clamp(controlledWidth) : uncontrolledWidth;

	return {
		width,
		panelRef,
		resizeHandleProps: { onMouseDown, onDoubleClick },
	};
}
