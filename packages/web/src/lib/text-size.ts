/**
 * App-wide text size presets. Each maps to a document-root font-size expressed as a
 * percentage of the user's browser default, so a raised OS/browser font preference is
 * preserved and the app's own multiplier stacks on top of it. Every rem-based size in
 * the app inherits from the root, so this one value scales all of them.
 *
 * The diff is intentionally unaffected: Pierre renders from its own absolute-px
 * `--diffs-*` custom properties inside a shadow root (see diff-typography.ts), which do
 * not inherit the root font-size. The diff keeps its own size control in Diff Display.
 *
 * The DEFAULT_* value is the single source of truth shared with the hook
 * (useLocalStorage initial value / pre-paint module init) so the stored default and
 * the applied fallback can never drift apart.
 */

export const TEXT_SIZE = {
	SMALLER: "smaller",
	SMALL: "small",
	DEFAULT: "default",
	LARGE: "large",
	LARGER: "larger",
} as const;
export type TextSize = (typeof TEXT_SIZE)[keyof typeof TEXT_SIZE];

export const DEFAULT_TEXT_SIZE: TextSize = TEXT_SIZE.DEFAULT;

/**
 * Root font-size per preset, as a percentage of the browser default. Default is 100%,
 * so it preserves today's rendering exactly while still honoring a user's raised
 * browser font preference. `value` is stored in localStorage.
 */
export const TEXT_SIZE_SCALE: Record<TextSize, string> = {
	[TEXT_SIZE.SMALLER]: "87.5%",
	[TEXT_SIZE.SMALL]: "93.75%",
	[TEXT_SIZE.DEFAULT]: "100%",
	[TEXT_SIZE.LARGE]: "112.5%",
	[TEXT_SIZE.LARGER]: "125%",
};

/** Options for the settings control, ordered smallest to largest. `value` is stored in localStorage. */
export const TEXT_SIZE_OPTIONS: { value: TextSize; label: string }[] = [
	{ value: TEXT_SIZE.SMALLER, label: "Smaller" },
	{ value: TEXT_SIZE.SMALL, label: "Small" },
	{ value: TEXT_SIZE.DEFAULT, label: "Default" },
	{ value: TEXT_SIZE.LARGE, label: "Large" },
	{ value: TEXT_SIZE.LARGER, label: "Larger" },
];

const VALID_TEXT_SIZES: ReadonlySet<string> = new Set<string>(Object.values(TEXT_SIZE));

export function isTextSize(value: string): value is TextSize {
	return VALID_TEXT_SIZES.has(value);
}

/** localStorage is a boundary: validate the stored value and fall back to the default. */
export function resolveStoredTextSize(stored: string | null): TextSize {
	if (stored && isTextSize(stored)) return stored;
	return DEFAULT_TEXT_SIZE;
}

export function resolveTextSizeScale(size: TextSize): string {
	return TEXT_SIZE_SCALE[size];
}
