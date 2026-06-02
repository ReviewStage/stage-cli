import { useHotkeys } from "react-hotkeys-hook";
import { KEYBOARD_SHORTCUTS } from "@/lib/keyboard-shortcuts";

export function useFileKeyboardModeExitKey(onExitKeyboardMode: () => void, enabled = true) {
	useHotkeys(
		KEYBOARD_SHORTCUTS.EXIT_FILE_KEYBOARD_MODE.hotkey,
		onExitKeyboardMode,
		{
			enabled,
			preventDefault: false,
			enableOnFormTags: false,
		},
		[onExitKeyboardMode],
	);
}
