import { APP_THEME, type AppTheme } from "./theme";

interface SyntaxTheme {
	value: string;
	label: string;
}

export const DEFAULT_SYNTAX_THEME_BY_APP_THEME: Record<AppTheme, string> = {
	[APP_THEME.DARK]: "pierre-dark",
	[APP_THEME.LIGHT]: "pierre-light",
};

/**
 * Mirrors shiki@3.20 bundledThemesInfo (the version @pierre/diffs@1.0.11 bundles) +
 * Pierre's two custom themes; regenerate when bumping @pierre/diffs. `value` is the
 * real theme id passed straight to Pierre — the selected theme renders exactly as
 * chosen. Sorted by label.
 *
 * Kept as a static list (no shiki runtime dependency, no 60-chunk dynamic-import
 * bloat).
 */
const SYNTAX_THEMES: SyntaxTheme[] = [
	{ value: "andromeeda", label: "Andromeeda" },
	{ value: "aurora-x", label: "Aurora X" },
	{ value: "ayu-dark", label: "Ayu Dark" },
	{ value: "catppuccin-frappe", label: "Catppuccin Frappé" },
	{ value: "catppuccin-latte", label: "Catppuccin Latte" },
	{ value: "catppuccin-macchiato", label: "Catppuccin Macchiato" },
	{ value: "catppuccin-mocha", label: "Catppuccin Mocha" },
	{ value: "dark-plus", label: "Dark Plus" },
	{ value: "dracula", label: "Dracula Theme" },
	{ value: "dracula-soft", label: "Dracula Theme Soft" },
	{ value: "everforest-dark", label: "Everforest Dark" },
	{ value: "everforest-light", label: "Everforest Light" },
	{ value: "github-dark", label: "GitHub Dark" },
	{ value: "github-dark-default", label: "GitHub Dark Default" },
	{ value: "github-dark-dimmed", label: "GitHub Dark Dimmed" },
	{ value: "github-dark-high-contrast", label: "GitHub Dark High Contrast" },
	{ value: "github-light", label: "GitHub Light" },
	{ value: "github-light-default", label: "GitHub Light Default" },
	{ value: "github-light-high-contrast", label: "GitHub Light High Contrast" },
	{ value: "gruvbox-dark-hard", label: "Gruvbox Dark Hard" },
	{ value: "gruvbox-dark-medium", label: "Gruvbox Dark Medium" },
	{ value: "gruvbox-dark-soft", label: "Gruvbox Dark Soft" },
	{ value: "gruvbox-light-hard", label: "Gruvbox Light Hard" },
	{ value: "gruvbox-light-medium", label: "Gruvbox Light Medium" },
	{ value: "gruvbox-light-soft", label: "Gruvbox Light Soft" },
	{ value: "houston", label: "Houston" },
	{ value: "kanagawa-dragon", label: "Kanagawa Dragon" },
	{ value: "kanagawa-lotus", label: "Kanagawa Lotus" },
	{ value: "kanagawa-wave", label: "Kanagawa Wave" },
	{ value: "laserwave", label: "LaserWave" },
	{ value: "light-plus", label: "Light Plus" },
	{ value: "material-theme", label: "Material Theme" },
	{ value: "material-theme-darker", label: "Material Theme Darker" },
	{ value: "material-theme-lighter", label: "Material Theme Lighter" },
	{ value: "material-theme-ocean", label: "Material Theme Ocean" },
	{ value: "material-theme-palenight", label: "Material Theme Palenight" },
	{ value: "min-dark", label: "Min Dark" },
	{ value: "min-light", label: "Min Light" },
	{ value: "monokai", label: "Monokai" },
	{ value: "night-owl", label: "Night Owl" },
	{ value: "nord", label: "Nord" },
	{ value: "one-dark-pro", label: "One Dark Pro" },
	{ value: "one-light", label: "One Light" },
	{ value: "pierre-dark", label: "Pierre Dark" },
	{ value: "pierre-light", label: "Pierre Light" },
	{ value: "plastic", label: "Plastic" },
	{ value: "poimandres", label: "Poimandres" },
	{ value: "red", label: "Red" },
	{ value: "rose-pine", label: "Rosé Pine" },
	{ value: "rose-pine-dawn", label: "Rosé Pine Dawn" },
	{ value: "rose-pine-moon", label: "Rosé Pine Moon" },
	{ value: "slack-dark", label: "Slack Dark" },
	{ value: "slack-ochin", label: "Slack Ochin" },
	{ value: "snazzy-light", label: "Snazzy Light" },
	{ value: "solarized-dark", label: "Solarized Dark" },
	{ value: "solarized-light", label: "Solarized Light" },
	{ value: "synthwave-84", label: "Synthwave '84" },
	{ value: "tokyo-night", label: "Tokyo Night" },
	{ value: "vesper", label: "Vesper" },
	{ value: "vitesse-black", label: "Vitesse Black" },
	{ value: "vitesse-dark", label: "Vitesse Dark" },
	{ value: "vitesse-light", label: "Vitesse Light" },
];

const LIGHT_SYNTAX_THEME_VALUES = new Set([
	"catppuccin-latte",
	"everforest-light",
	"github-light",
	"github-light-default",
	"github-light-high-contrast",
	"gruvbox-light-hard",
	"gruvbox-light-medium",
	"gruvbox-light-soft",
	"kanagawa-lotus",
	"light-plus",
	"material-theme-lighter",
	"min-light",
	"one-light",
	"pierre-light",
	"rose-pine-dawn",
	"slack-ochin",
	"snazzy-light",
	"solarized-light",
	"vitesse-light",
]);

export const SYNTAX_THEME_OPTIONS = SYNTAX_THEMES;

export const SYNTAX_THEME_OPTIONS_BY_APP_THEME: Record<AppTheme, SyntaxTheme[]> = {
	[APP_THEME.DARK]: SYNTAX_THEMES.filter((theme) => !LIGHT_SYNTAX_THEME_VALUES.has(theme.value)),
	[APP_THEME.LIGHT]: SYNTAX_THEMES.filter((theme) => LIGHT_SYNTAX_THEME_VALUES.has(theme.value)),
};

const syntaxThemeValues = new Set(SYNTAX_THEMES.map((t) => t.value));

/**
 * Whether a stored theme id is valid for the given mode. Light and dark persist
 * their syntax theme independently, so a value is only valid in the mode whose
 * palette it belongs to; callers fall back to that mode's default otherwise.
 */
export function isSyntaxThemeForAppTheme(value: string, appTheme: AppTheme): boolean {
	if (!syntaxThemeValues.has(value)) return false;
	const isLightTheme = LIGHT_SYNTAX_THEME_VALUES.has(value);
	return appTheme === APP_THEME.LIGHT ? isLightTheme : !isLightTheme;
}

/**
 * Transitional bridge for callers that still resolve the stored value through the
 * old curated-pair API. Stored values are now real shiki theme ids validated per
 * app theme, so this is a pass-through with a mode-default fallback. Callers can
 * pass `syntaxTheme` from useDiffSettings straight to Pierre and drop this call.
 */
export function resolveSyntaxTheme(themeValue: string, appTheme: AppTheme): string {
	return isSyntaxThemeForAppTheme(themeValue, appTheme)
		? themeValue
		: DEFAULT_SYNTAX_THEME_BY_APP_THEME[appTheme];
}

/**
 * Dark/light concrete theme ids for each value of the retired curated single-key
 * set (the legacy `diff-syntaxTheme` localStorage key). Used once at startup to
 * seed the new per-app-theme keys; see use-diff-settings.tsx.
 */
const LEGACY_SYNTAX_THEME_PAIRS: Record<string, { dark: string; light: string }> = {
	pierre: { dark: "pierre-dark", light: "pierre-light" },
	andromeeda: { dark: "andromeeda", light: "pierre-light" },
	"aurora-x": { dark: "aurora-x", light: "pierre-light" },
	"ayu-dark": { dark: "ayu-dark", light: "pierre-light" },
	"catppuccin-frappe": { dark: "catppuccin-frappe", light: "catppuccin-latte" },
	"catppuccin-latte": { dark: "catppuccin-mocha", light: "catppuccin-latte" },
	"catppuccin-macchiato": { dark: "catppuccin-macchiato", light: "catppuccin-latte" },
	"catppuccin-mocha": { dark: "catppuccin-mocha", light: "catppuccin-latte" },
	"dark-plus": { dark: "dark-plus", light: "light-plus" },
	dracula: { dark: "dracula", light: "pierre-light" },
	"dracula-soft": { dark: "dracula-soft", light: "pierre-light" },
	everforest: { dark: "everforest-dark", light: "everforest-light" },
	github: { dark: "github-dark", light: "github-light" },
	"github-default": { dark: "github-dark-default", light: "github-light-default" },
	"github-dimmed": { dark: "github-dark-dimmed", light: "github-light-default" },
	"github-high-contrast": {
		dark: "github-dark-high-contrast",
		light: "github-light-high-contrast",
	},
	"gruvbox-hard": { dark: "gruvbox-dark-hard", light: "gruvbox-light-hard" },
	"gruvbox-medium": { dark: "gruvbox-dark-medium", light: "gruvbox-light-medium" },
	"gruvbox-soft": { dark: "gruvbox-dark-soft", light: "gruvbox-light-soft" },
	houston: { dark: "houston", light: "pierre-light" },
	"kanagawa-dragon": { dark: "kanagawa-dragon", light: "kanagawa-lotus" },
	"kanagawa-wave": { dark: "kanagawa-wave", light: "kanagawa-lotus" },
	laserwave: { dark: "laserwave", light: "pierre-light" },
	material: { dark: "material-theme", light: "material-theme-lighter" },
	"material-darker": { dark: "material-theme-darker", light: "material-theme-lighter" },
	"material-ocean": { dark: "material-theme-ocean", light: "material-theme-lighter" },
	"material-palenight": { dark: "material-theme-palenight", light: "material-theme-lighter" },
	min: { dark: "min-dark", light: "min-light" },
	monokai: { dark: "monokai", light: "pierre-light" },
	"night-owl": { dark: "night-owl", light: "pierre-light" },
	nord: { dark: "nord", light: "pierre-light" },
	one: { dark: "one-dark-pro", light: "one-light" },
	plastic: { dark: "plastic", light: "pierre-light" },
	poimandres: { dark: "poimandres", light: "pierre-light" },
	red: { dark: "red", light: "pierre-light" },
	"rose-pine": { dark: "rose-pine", light: "rose-pine-dawn" },
	"rose-pine-moon": { dark: "rose-pine-moon", light: "rose-pine-dawn" },
	slack: { dark: "slack-dark", light: "slack-ochin" },
	"snazzy-light": { dark: "pierre-dark", light: "snazzy-light" },
	solarized: { dark: "solarized-dark", light: "solarized-light" },
	"synthwave-84": { dark: "synthwave-84", light: "pierre-light" },
	"tokyo-night": { dark: "tokyo-night", light: "pierre-light" },
	vesper: { dark: "vesper", light: "pierre-light" },
	vitesse: { dark: "vitesse-dark", light: "vitesse-light" },
	"vitesse-black": { dark: "vitesse-black", light: "vitesse-light" },
};

export function resolveLegacySyntaxTheme(value: string): { dark: string; light: string } | null {
	// The stored value is a boundary: unknown keys are expected and mean "no migration".
	// Object.hasOwn (not plain indexing) so inherited prototype keys are rejected.
	if (!Object.hasOwn(LEGACY_SYNTAX_THEME_PAIRS, value)) return null;
	return LEGACY_SYNTAX_THEME_PAIRS[value] ?? null;
}
