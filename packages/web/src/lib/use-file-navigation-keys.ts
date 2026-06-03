import { useHotkeys } from "react-hotkeys-hook";
import type { PullRequestFile } from "@/lib/diff-types";
import { KEYBOARD_SHORTCUTS } from "@/lib/keyboard-shortcuts";

/**
 * Hook for keyboard navigation between files (j/k keys)
 * Uses react-hotkeys-hook for automatic cleanup and input field exclusion
 */
export function useFileNavigationKeys(
	files: PullRequestFile[],
	currentFilePath: string | undefined,
	onFocusFile: (filePath: string) => void,
	enabled = true,
) {
	useHotkeys(
		KEYBOARD_SHORTCUTS.NEXT_FILE.hotkey,
		() => {
			if (files.length === 0) return;

			if (currentFilePath === undefined) {
				const firstFile = files[0];
				if (!firstFile) return;
				onFocusFile(firstFile.path);
				return;
			}

			const currentIndex = files.findIndex((f) => f.path === currentFilePath);
			if (currentIndex === -1) return;
			const targetFile = files[currentIndex + 1] ?? files[currentIndex];
			if (targetFile) onFocusFile(targetFile.path);
		},
		{
			enabled,
			preventDefault: true,
			enableOnFormTags: false,
		},
		[files, currentFilePath, onFocusFile],
	);

	useHotkeys(
		KEYBOARD_SHORTCUTS.PREV_FILE.hotkey,
		() => {
			if (files.length === 0) return;

			if (currentFilePath === undefined) {
				const lastFile = files.at(-1);
				if (!lastFile) return;
				onFocusFile(lastFile.path);
				return;
			}

			const currentIndex = files.findIndex((f) => f.path === currentFilePath);
			if (currentIndex === -1) return;
			const targetFile = files[currentIndex - 1] ?? files[currentIndex];
			if (targetFile) onFocusFile(targetFile.path);
		},
		{
			enabled,
			preventDefault: true,
			enableOnFormTags: false,
		},
		[files, currentFilePath, onFocusFile],
	);
}
