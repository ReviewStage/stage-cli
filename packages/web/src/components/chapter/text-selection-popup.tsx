import type { SelectedLineRange } from "@pierre/diffs";
import { MessageSquare } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface TextSelectionPopupProps {
	/** Bounding rect of the text selection in page (document) coordinates. */
	selectionRect: DOMRect;
	lineRange: SelectedLineRange;
	onComment: (lineRange: SelectedLineRange) => void;
}

/**
 * Clamp the popup's anchor so it stays within the viewport after the CSS
 * `translate(-50%)`. Measured in a layout effect since the width is unknown
 * until rendered.
 */
function clampHorizontally(popup: HTMLElement, anchorLeft: number) {
	const halfWidth = popup.offsetWidth / 2;
	const minLeft = window.scrollX + halfWidth + 8;
	const maxLeft = window.innerWidth + window.scrollX - halfWidth - 8;
	popup.style.left = `${Math.max(minLeft, Math.min(anchorLeft, maxLeft))}px`;
}

const BUTTON_CLASS =
	"flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium text-zinc-100 transition-colors hover:bg-white/10";

export function TextSelectionPopup({
	selectionRect,
	lineRange,
	onComment,
}: TextSelectionPopupProps) {
	const popupRef = useRef<HTMLDivElement>(null);

	// selectionRect is already in page coordinates; `translate(-50%, -100%)`
	// centers the popup horizontally and floats it just above the selection.
	const top = selectionRect.top - 8;
	const left = selectionRect.left + selectionRect.width / 2;

	useLayoutEffect(() => {
		const popup = popupRef.current;
		if (!popup) return;
		clampHorizontally(popup, left);
	}, [left]);

	const isMultiLine = lineRange.start !== lineRange.end;
	const rangeLabel = isMultiLine
		? `lines ${lineRange.start}–${lineRange.end}`
		: `line ${lineRange.start}`;

	return createPortal(
		<div
			ref={popupRef}
			data-text-selection-popup
			style={{
				position: "absolute",
				top,
				left,
				transform: "translate(-50%, -100%)",
				zIndex: 50,
			}}
		>
			<div className="inline-flex items-center gap-0.5 rounded-md border border-white/10 bg-zinc-950/95 p-1 shadow-black/20 shadow-lg backdrop-blur-sm">
				<button
					type="button"
					aria-label={`Comment on ${rangeLabel}`}
					className={BUTTON_CLASS}
					// Keep the text selection from collapsing before the click resolves.
					onMouseDown={(e) => e.preventDefault()}
					onClick={() => onComment(lineRange)}
				>
					<MessageSquare className="size-3" />
					Comment
				</button>
			</div>
		</div>,
		document.body,
	);
}
