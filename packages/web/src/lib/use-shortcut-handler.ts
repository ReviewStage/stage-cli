import { useEffect } from "react";
import { isEditableTarget } from "./keyboard";
import { KEYBOARD_SHORTCUTS, type ShortcutKey } from "./keyboard-shortcuts";

/**
 * Wires a registry-defined keyboard shortcut to a handler. Skips when the
 * focus is inside an editable element so single-key shortcuts can't fire
 * mid-typing. Mirrors hosted-stage's `useHotkeys` shape minus the dependency.
 */
export function useShortcutHandler(key: ShortcutKey, handler: () => void, enabled = true): void {
	const { hotkey } = KEYBOARD_SHORTCUTS[key];

	useEffect(() => {
		if (!enabled) return;
		const parsed = parseHotkey(hotkey);

		function listener(event: KeyboardEvent): void {
			if (isEditableTarget(event.target)) return;
			if (event.key.toLowerCase() !== parsed.key) return;
			if (parsed.shift !== event.shiftKey) return;
			if (parsed.meta !== event.metaKey) return;
			if (parsed.ctrl !== event.ctrlKey) return;
			if (parsed.alt !== event.altKey) return;
			event.preventDefault();
			handler();
		}

		window.addEventListener("keydown", listener);
		return () => window.removeEventListener("keydown", listener);
	}, [hotkey, handler, enabled]);
}

interface ParsedHotkey {
	key: string;
	shift: boolean;
	meta: boolean;
	ctrl: boolean;
	alt: boolean;
}

function parseHotkey(hotkey: string): ParsedHotkey {
	const parts = hotkey.toLowerCase().split("+");
	const result: ParsedHotkey = { key: "", shift: false, meta: false, ctrl: false, alt: false };
	for (const part of parts) {
		switch (part) {
			case "shift":
				result.shift = true;
				break;
			case "meta":
			case "cmd":
				result.meta = true;
				break;
			case "ctrl":
				result.ctrl = true;
				break;
			case "alt":
			case "option":
				result.alt = true;
				break;
			default:
				result.key = part;
		}
	}
	return result;
}
