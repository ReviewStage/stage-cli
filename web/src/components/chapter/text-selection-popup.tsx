import type { SelectedLineRange } from "@pierre/diffs";

interface TextSelectionPopupProps {
  selectionRect: DOMRect;
  lineRange: SelectedLineRange;
  onComment: (lineRange: SelectedLineRange) => void;
}

export function TextSelectionPopup(_props: TextSelectionPopupProps) {
  return null;
}
