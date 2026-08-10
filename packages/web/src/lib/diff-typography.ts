/**
 * Resolves user diff-typography settings into the inherited CSS custom properties
 * Pierre reads (`--diffs-font-family`, `--diffs-font-size`, `--diffs-line-height`,
 * `--diffs-font-features`).
 *
 * The DEFAULT_* values are the single source of truth shared with the diff settings
 * store (useLocalStorage initial values) so the stored default and the resolver
 * fallback can never drift apart.
 */

/**
 * GitHub's monospace stack (its `--fontStack-monospace`). Resolves to each OS's
 * native mono — SF Mono on macOS, Consolas on Windows — exactly like GitHub's diff
 * view. The "GitHub" font preset emits this verbatim.
 */
const GITHUB_MONO_STACK =
	"ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

/**
 * Appended after a chosen webfont so it degrades to Geist Mono and then GitHub's
 * resolving stack — never Pierre's own fallback, which leads with `'SF Mono'` and
 * falls through to Monaco.
 */
const FALLBACK_STACK = `'Geist Mono', ${GITHUB_MONO_STACK}`;

const GITHUB_FONT = "GitHub";

/**
 * Preset diff fonts. index.html loads these from Google Fonts (matching hosted);
 * offline they degrade through FALLBACK_STACK to whatever is installed locally.
 * GitHub is a system-font stack and needs no webfont. Sorted by label.
 * `value` is stored in localStorage.
 */
export const DIFF_FONT_OPTIONS: { value: string; label: string }[] = [
	{ value: "Cascadia Code", label: "Cascadia Code" },
	{ value: "Fira Code", label: "Fira Code" },
	{ value: "Geist Mono", label: "Geist Mono" },
	{ value: GITHUB_FONT, label: "GitHub" },
	{ value: "IBM Plex Mono", label: "IBM Plex Mono" },
	{ value: "JetBrains Mono", label: "JetBrains Mono" },
];

export const DEFAULT_DIFF_FONT_FAMILY = "Geist Mono";
export const DEFAULT_DIFF_FONT_SIZE = "12";
export const DEFAULT_DIFF_LIGATURES = false;
export const FONT_SIZE_VALUES = ["10", "11", "12", "13", "14", "15"] as const;
export type DiffFontSize = (typeof FONT_SIZE_VALUES)[number];

/**
 * Line-height density presets. Each resolves to a unitless ratio (see
 * `LINE_HEIGHT_RATIOS`), so the rendered row height scales with the chosen
 * font size rather than being pinned to a fixed pixel value.
 */
export const DIFF_LINE_HEIGHT = {
	COMPACT: "compact",
	NORMAL: "normal",
	SPACIOUS: "spacious",
} as const;
export type DiffLineHeight = (typeof DIFF_LINE_HEIGHT)[keyof typeof DIFF_LINE_HEIGHT];

export const DEFAULT_DIFF_LINE_HEIGHT: DiffLineHeight = DIFF_LINE_HEIGHT.NORMAL;

/** Preset font sizes (px). `value` is stored in localStorage. */
export const FONT_SIZE_OPTIONS: { value: DiffFontSize; label: string }[] = FONT_SIZE_VALUES.map(
	(v) => ({
		value: v,
		label: `${v}px`,
	}),
);

/** Line-height density presets, ordered tightest to roomiest. `value` is stored in localStorage. */
export const LINE_HEIGHT_OPTIONS: { value: DiffLineHeight; label: string }[] = [
	{ value: DIFF_LINE_HEIGHT.COMPACT, label: "Compact" },
	{ value: DIFF_LINE_HEIGHT.NORMAL, label: "Normal" },
	{ value: DIFF_LINE_HEIGHT.SPACIOUS, label: "Spacious" },
];

const fontValues = new Set(DIFF_FONT_OPTIONS.map((f) => f.value));
const fontSizeValues = new Set<string>(FONT_SIZE_VALUES);
const lineHeightValues = new Set<string>(Object.values(DIFF_LINE_HEIGHT));

/**
 * Unitless line-height multipliers. CSS multiplies each by the resolved font
 * size, so a denser or roomier setting scales with the user's chosen font size
 * instead of overlapping (when the font outgrows a fixed height) or stranding
 * extra space (when it shrinks). Centered on ~1.65 to match GitHub's diff.
 */
const LINE_HEIGHT_RATIOS: Record<DiffLineHeight, string> = {
	[DIFF_LINE_HEIGHT.COMPACT]: "1.45",
	[DIFF_LINE_HEIGHT.NORMAL]: "1.65",
	[DIFF_LINE_HEIGHT.SPACIOUS]: "1.85",
};

export function isDiffFontFamily(input: string): boolean {
	return fontValues.has(input);
}

export function resolveFontFamily(value: string): string {
	if (value === GITHUB_FONT) return GITHUB_MONO_STACK;
	const family = fontValues.has(value) ? value : DEFAULT_DIFF_FONT_FAMILY;
	return `'${family}', ${FALLBACK_STACK}`;
}

export function isDiffFontSize(input: string): input is DiffFontSize {
	return fontSizeValues.has(input);
}

export function resolveFontSize(input: string): string {
	const size = fontSizeValues.has(input) ? input : DEFAULT_DIFF_FONT_SIZE;
	return `${size}px`;
}

export function isDiffLineHeight(input: string): input is DiffLineHeight {
	return lineHeightValues.has(input);
}

export function resolveLineHeight(input: DiffLineHeight): string {
	return LINE_HEIGHT_RATIOS[input];
}

export function resolveFontFeatures(ligatures: boolean): string {
	return ligatures ? "'liga' 1, 'calt' 1" : "'liga' 0, 'calt' 0";
}
