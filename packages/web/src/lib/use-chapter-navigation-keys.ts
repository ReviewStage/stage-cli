import { useHotkeys } from "react-hotkeys-hook";
import { KEYBOARD_SHORTCUTS } from "./keyboard-shortcuts";

export const NAVIGATION_DIRECTION = {
	NEXT: "next",
	PREV: "prev",
} as const;
export type NavigationDirection = (typeof NAVIGATION_DIRECTION)[keyof typeof NAVIGATION_DIRECTION];

/**
 * Bind ←/→ to navigate between chapters. No-op when `enabled` is false (e.g.
 * while data is still loading) so an arrow press doesn't fire against a stale
 * `navigateToChapter` reference.
 */
export function useChapterNavigationKeys(
	navigateToChapter: (direction: NavigationDirection) => void,
	enabled = true,
) {
	useHotkeys(
		KEYBOARD_SHORTCUTS.NEXT_CHAPTER.hotkey,
		() => navigateToChapter(NAVIGATION_DIRECTION.NEXT),
		{ enabled, preventDefault: true, enableOnFormTags: false },
		[navigateToChapter],
	);

	useHotkeys(
		KEYBOARD_SHORTCUTS.PREV_CHAPTER.hotkey,
		() => navigateToChapter(NAVIGATION_DIRECTION.PREV),
		{ enabled, preventDefault: true, enableOnFormTags: false },
		[navigateToChapter],
	);
}
