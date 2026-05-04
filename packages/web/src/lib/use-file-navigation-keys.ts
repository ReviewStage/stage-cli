import { useHotkeys } from "react-hotkeys-hook";
import { KEYBOARD_SHORTCUTS } from "@/lib/keyboard-shortcuts";

/**
 * Bind j/k to step through `files` by path. Falls back to the first file when
 * nothing is currently active. No-op at the ends of the list.
 */
export function useFileNavigationKeys(
	files: { path: string }[],
	activeFilePath: string | undefined,
	onSelectFile: (filePath: string) => void,
) {
	useHotkeys(
		KEYBOARD_SHORTCUTS.NEXT_FILE.hotkey,
		() => {
			const next = stepFile(files, activeFilePath, 1);
			if (next) onSelectFile(next);
		},
		{ preventDefault: true, enableOnFormTags: false },
		[files, activeFilePath, onSelectFile],
	);

	useHotkeys(
		KEYBOARD_SHORTCUTS.PREV_FILE.hotkey,
		() => {
			const prev = stepFile(files, activeFilePath, -1);
			if (prev) onSelectFile(prev);
		},
		{ preventDefault: true, enableOnFormTags: false },
		[files, activeFilePath, onSelectFile],
	);
}

function stepFile(
	files: { path: string }[],
	activeFilePath: string | undefined,
	delta: 1 | -1,
): string | undefined {
	if (files.length === 0) return undefined;
	const first = files[0];
	if (!first) return undefined;
	if (!activeFilePath) return first.path;

	const currentIndex = files.findIndex((f) => f.path === activeFilePath);
	if (currentIndex === -1) return first.path;

	const targetIndex = currentIndex + delta;
	const target = files[targetIndex];
	return target?.path;
}
