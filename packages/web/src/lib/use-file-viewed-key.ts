import { useHotkeys } from "react-hotkeys-hook";
import type { PullRequestFile } from "@/lib/diff-types";
import { KEYBOARD_SHORTCUTS } from "@/lib/keyboard-shortcuts";

/**
 * Hook for marking a file as viewed via the `v` key.
 *
 * When no file is focused yet, the `v` key acts on the first file so the user
 * doesn't have to press `j`/`k` first. `onMarkViewed` receives both the file
 * that was marked and the file that follows it (or `undefined` at the end of
 * the list) so the caller can advance focus and let the user keep pressing `v`.
 */
export function useFileViewedKey(
	files: PullRequestFile[],
	currentFilePath: string | undefined,
	onMarkViewed: (markedFilePath: string, nextFilePath: string | undefined) => void,
	enabled = true,
) {
	useHotkeys(
		KEYBOARD_SHORTCUTS.MARK_FILE_AS_VIEWED.hotkey,
		() => {
			if (files.length === 0) return;
			const markedIndex =
				currentFilePath === undefined ? 0 : files.findIndex((f) => f.path === currentFilePath);
			const markedFile = files[markedIndex];
			if (!markedFile) return;
			onMarkViewed(markedFile.path, files[markedIndex + 1]?.path);
		},
		{
			enabled,
			preventDefault: true,
			enableOnFormTags: false,
		},
		[files, currentFilePath, onMarkViewed],
	);
}
