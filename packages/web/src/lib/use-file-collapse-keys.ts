import { useHotkeys } from "react-hotkeys-hook";
import type { PullRequestFile } from "@/lib/diff-types";
import { KEYBOARD_SHORTCUTS } from "@/lib/keyboard-shortcuts";

/**
 * Hook for collapse/expand shortcuts:
 * - `;` toggles the focused file, defaulting to the first file when none is
 *   focused so the user doesn't have to press `j`/`k` first
 * - `Shift+;` toggles all files (collapse if any expanded, expand if all collapsed)
 */
export function useFileCollapseKeys(
	files: PullRequestFile[],
	currentFilePath: string | undefined,
	onToggleCollapsed: (filePath: string) => void,
	collapseAllFiles: () => void,
	expandAllFiles: () => void,
	allCollapsed: boolean,
	enabled = true,
) {
	useHotkeys(
		KEYBOARD_SHORTCUTS.TOGGLE_FILE_COLLAPSED.hotkey,
		() => {
			if (files.length === 0) return;
			const targetPath = currentFilePath === undefined ? files[0]?.path : currentFilePath;
			if (targetPath === undefined) return;
			onToggleCollapsed(targetPath);
		},
		{
			enabled,
			preventDefault: true,
			enableOnFormTags: false,
			...KEYBOARD_SHORTCUTS.TOGGLE_FILE_COLLAPSED.hotkeyOptions,
		},
		[files, currentFilePath, onToggleCollapsed],
	);

	useHotkeys(
		KEYBOARD_SHORTCUTS.TOGGLE_ALL_FILES_COLLAPSED.hotkey,
		() => {
			if (allCollapsed) {
				expandAllFiles();
			} else {
				collapseAllFiles();
			}
		},
		{
			enabled,
			preventDefault: true,
			enableOnFormTags: false,
		},
		[allCollapsed, collapseAllFiles, expandAllFiles],
	);
}
