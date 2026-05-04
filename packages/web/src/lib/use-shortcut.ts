import { KEYBOARD_SHORTCUTS, type ShortcutKey } from "./keyboard-shortcuts";
import { useIsMac } from "./use-is-mac";

export function useShortcut(key: ShortcutKey) {
	const isMac = useIsMac();
	const entry = KEYBOARD_SHORTCUTS[key];
	const platform = isMac ? entry.mac : entry.nonMac;
	return {
		hotkey: entry.hotkey,
		label: platform.label,
		ariaKeyshortcuts: platform.ariaKeyshortcuts,
	};
}
