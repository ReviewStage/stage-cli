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
	TOGGLE_FILE_COLLAPSED: {
		hotkey: ";",
		hotkeyOptions: { useKey: true },
		description: "Collapse/expand file",
		group: "Navigation",
		mac: { label: ";", ariaKeyshortcuts: "Semicolon" },
		nonMac: { label: ";", ariaKeyshortcuts: "Semicolon" },
	},
	TOGGLE_ALL_FILES_COLLAPSED: {
		hotkey: "shift+semicolon",
		description: "Collapse/expand all files",
		group: "Navigation",
		mac: { label: "⇧ ;", ariaKeyshortcuts: "Shift+Semicolon" },
		nonMac: { label: "Shift ;", ariaKeyshortcuts: "Shift+Semicolon" },
	},
	EXIT_FILE_KEYBOARD_MODE: {
		hotkey: "esc",
		description: "Hide file focus",
		group: "Navigation",
		mac: { label: "Esc", ariaKeyshortcuts: "Escape" },
		nonMac: { label: "Esc", ariaKeyshortcuts: "Escape" },
	},
	NEXT_CHAPTER: {
		hotkey: "right",
		description: "Next chapter",
		group: "Navigation",
		mac: { label: "→", ariaKeyshortcuts: "ArrowRight" },
		nonMac: { label: "→", ariaKeyshortcuts: "ArrowRight" },
	},
	PREV_CHAPTER: {
		hotkey: "left",
		description: "Previous chapter",
		group: "Navigation",
		mac: { label: "←", ariaKeyshortcuts: "ArrowLeft" },
		nonMac: { label: "←", ariaKeyshortcuts: "ArrowLeft" },
	},
	MARK_FILE_AS_VIEWED: {
		hotkey: "v",
		description: "Toggle mark file as viewed",
		group: "Review",
		mac: { label: "v", ariaKeyshortcuts: "V" },
		nonMac: { label: "v", ariaKeyshortcuts: "V" },
	},
	MARK_CHAPTER_AS_VIEWED: {
		hotkey: "shift+v",
		description: "Toggle mark chapter as viewed",
		group: "Review",
		mac: { label: "⇧ V", ariaKeyshortcuts: "Shift+V" },
		nonMac: { label: "Shift V", ariaKeyshortcuts: "Shift+V" },
	},
	COPY_BRANCH_NAME: {
		hotkey: "shift+c",
		description: "Copy branch name",
		group: "Review",
		mac: { label: "⇧ C", ariaKeyshortcuts: "Shift+C" },
		nonMac: { label: "Shift C", ariaKeyshortcuts: "Shift+C" },
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
