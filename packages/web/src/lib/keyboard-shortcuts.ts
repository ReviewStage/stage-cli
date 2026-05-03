/**
 * Central registry of every keyboard shortcut. New shortcuts go here so the
 * `?` overlay, `aria-keyshortcuts` attributes, and tooltips stay in sync. The
 * shape mirrors hosted-stage's registry — keep it identical so shortcuts can
 * be ported between the two repos with minimal friction.
 */
export const KEYBOARD_SHORTCUTS = {
	TOGGLE_FILES: {
		hotkey: "shift+f",
		description: "Toggle files panel",
		group: "Panels",
		mac: { label: "⇧ F", ariaKeyshortcuts: "Shift+F" },
		nonMac: { label: "Shift F", ariaKeyshortcuts: "Shift+F" },
	},
} as const;

export type ShortcutKey = keyof typeof KEYBOARD_SHORTCUTS;

export const SHORTCUT_KEY = Object.fromEntries(
	Object.keys(KEYBOARD_SHORTCUTS).map((k) => [k, k]),
) as { [K in ShortcutKey]: K };

export type ShortcutGroup = (typeof KEYBOARD_SHORTCUTS)[ShortcutKey]["group"];
