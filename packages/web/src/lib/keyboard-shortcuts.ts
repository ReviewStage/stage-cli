export const KEYBOARD_SHORTCUTS = {
	SHOW_SHORTCUTS: {
		hotkey: "?",
		hotkeyOptions: { useKey: true },
		description: "Show keyboard shortcuts",
		group: "General",
		mac: { label: "?", ariaKeyshortcuts: "Shift+Slash" },
		nonMac: { label: "?", ariaKeyshortcuts: "Shift+Slash" },
	},
	TOGGLE_FILES: {
		hotkey: "shift+f",
		description: "Toggle files panel",
		group: "Panels",
		mac: { label: "⇧ F", ariaKeyshortcuts: "Shift+F" },
		nonMac: { label: "Shift F", ariaKeyshortcuts: "Shift+F" },
	},
	NEXT_FILE: {
		hotkey: "j",
		description: "Next file",
		group: "Navigation",
		mac: { label: "j", ariaKeyshortcuts: "J" },
		nonMac: { label: "j", ariaKeyshortcuts: "J" },
	},
	PREV_FILE: {
		hotkey: "k",
		description: "Previous file",
		group: "Navigation",
		mac: { label: "k", ariaKeyshortcuts: "K" },
		nonMac: { label: "k", ariaKeyshortcuts: "K" },
	},
	MARK_CHAPTER_AS_VIEWED: {
		hotkey: "v",
		hotkeyOptions: { useKey: true },
		description: "Toggle mark chapter as viewed",
		group: "Review",
		mac: { label: "v", ariaKeyshortcuts: "V" },
		nonMac: { label: "v", ariaKeyshortcuts: "V" },
	},
} as const;

export type ShortcutKey = keyof typeof KEYBOARD_SHORTCUTS;

export const SHORTCUT_KEY = Object.fromEntries(
	Object.keys(KEYBOARD_SHORTCUTS).map((k) => [k, k]),
) as { [K in ShortcutKey]: K };

export type ShortcutGroup = (typeof KEYBOARD_SHORTCUTS)[ShortcutKey]["group"];

/** Shortcuts grouped by their `group` field, preserving registry order. */
export function getShortcutsByGroup() {
	const groups = new Map<
		ShortcutGroup,
		{ key: ShortcutKey; entry: (typeof KEYBOARD_SHORTCUTS)[ShortcutKey] }[]
	>();
	for (const key of Object.keys(KEYBOARD_SHORTCUTS) as ShortcutKey[]) {
		const entry = KEYBOARD_SHORTCUTS[key];
		const list = groups.get(entry.group) ?? [];
		list.push({ key, entry });
		groups.set(entry.group, list);
	}
	return groups;
}
