import type { SelectedLineRange } from "@pierre/diffs";
import { MessageSquarePlus } from "lucide-react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

interface TextSelectionPopupProps {
	selectionRect: DOMRect;
	lineRange: SelectedLineRange;
	onComment: (lineRange: SelectedLineRange) => void;
}

export function TextSelectionPopup({
	selectionRect,
	lineRange,
	onComment,
}: TextSelectionPopupProps) {
	// Portaled to the body so the diff's overflow:hidden can't clip it. The rect
	// is already in page coordinates (the selection hook adds scroll offsets).
	return createPortal(
		<div
			data-text-selection-popup
			className="-translate-x-1/2 absolute z-50"
			style={{
				top: selectionRect.bottom + 6,
				left: selectionRect.left + selectionRect.width / 2,
			}}
		>
			<Button
				size="sm"
				className="h-7 gap-1.5 rounded-lg shadow-md"
				// Keep the text selection from collapsing before the click resolves.
				onMouseDown={(e) => e.preventDefault()}
				onClick={() => onComment(lineRange)}
			>
				<MessageSquarePlus className="size-3.5" />
				Comment
			</Button>
		</div>,
		document.body,
	);
}
