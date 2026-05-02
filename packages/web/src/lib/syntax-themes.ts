interface SyntaxTheme {
	value: string;
	label: string;
	dark: string;
	light: string;
}

const PIERRE_DARK = "pierre-dark";
const PIERRE_LIGHT = "pierre-light";

const SYNTAX_THEMES: SyntaxTheme[] = [
	{ value: "pierre", label: "Pierre", dark: PIERRE_DARK, light: PIERRE_LIGHT },
	{ value: "andromeeda", label: "Andromeeda", dark: "andromeeda", light: PIERRE_LIGHT },
	{ value: "aurora-x", label: "Aurora X", dark: "aurora-x", light: PIERRE_LIGHT },
	{ value: "ayu-dark", label: "Ayu Dark", dark: "ayu-dark", light: PIERRE_LIGHT },
	{
		value: "catppuccin-frappe",
		label: "Catppuccin Frappé",
		dark: "catppuccin-frappe",
		light: "catppuccin-latte",
	},
	{
		value: "catppuccin-latte",
		label: "Catppuccin Latte",
		dark: "catppuccin-mocha",
		light: "catppuccin-latte",
	},
	{
		value: "catppuccin-macchiato",
		label: "Catppuccin Macchiato",
		dark: "catppuccin-macchiato",
		light: "catppuccin-latte",
	},
	{
		value: "catppuccin-mocha",
		label: "Catppuccin Mocha",
		dark: "catppuccin-mocha",
		light: "catppuccin-latte",
	},
	{ value: "dark-plus", label: "Dark Plus / Light Plus", dark: "dark-plus", light: "light-plus" },
	{ value: "dracula", label: "Dracula", dark: "dracula", light: PIERRE_LIGHT },
	{ value: "dracula-soft", label: "Dracula Soft", dark: "dracula-soft", light: PIERRE_LIGHT },
	{ value: "everforest", label: "Everforest", dark: "everforest-dark", light: "everforest-light" },
	{ value: "github", label: "GitHub", dark: "github-dark", light: "github-light" },
	{
		value: "github-default",
		label: "GitHub Default",
		dark: "github-dark-default",
		light: "github-light-default",
	},
	{
		value: "github-dimmed",
		label: "GitHub Dimmed",
		dark: "github-dark-dimmed",
		light: "github-light-default",
	},
	{
		value: "github-high-contrast",
		label: "GitHub High Contrast",
		dark: "github-dark-high-contrast",
		light: "github-light-high-contrast",
	},
	{
		value: "gruvbox-hard",
		label: "Gruvbox Hard",
		dark: "gruvbox-dark-hard",
		light: "gruvbox-light-hard",
	},
	{
		value: "gruvbox-medium",
		label: "Gruvbox Medium",
		dark: "gruvbox-dark-medium",
		light: "gruvbox-light-medium",
	},
	{
		value: "gruvbox-soft",
		label: "Gruvbox Soft",
		dark: "gruvbox-dark-soft",
		light: "gruvbox-light-soft",
	},
	{ value: "houston", label: "Houston", dark: "houston", light: PIERRE_LIGHT },
	{
		value: "kanagawa-dragon",
		label: "Kanagawa Dragon",
		dark: "kanagawa-dragon",
		light: "kanagawa-lotus",
	},
	{
		value: "kanagawa-wave",
		label: "Kanagawa Wave",
		dark: "kanagawa-wave",
		light: "kanagawa-lotus",
	},
	{ value: "laserwave", label: "LaserWave", dark: "laserwave", light: PIERRE_LIGHT },
	{ value: "material", label: "Material", dark: "material-theme", light: "material-theme-lighter" },
	{
		value: "material-darker",
		label: "Material Darker",
		dark: "material-theme-darker",
		light: "material-theme-lighter",
	},
	{
		value: "material-ocean",
		label: "Material Ocean",
		dark: "material-theme-ocean",
		light: "material-theme-lighter",
	},
	{
		value: "material-palenight",
		label: "Material Palenight",
		dark: "material-theme-palenight",
		light: "material-theme-lighter",
	},
	{ value: "min", label: "Min", dark: "min-dark", light: "min-light" },
	{ value: "monokai", label: "Monokai", dark: "monokai", light: PIERRE_LIGHT },
	{ value: "night-owl", label: "Night Owl", dark: "night-owl", light: PIERRE_LIGHT },
	{ value: "nord", label: "Nord", dark: "nord", light: PIERRE_LIGHT },
	{ value: "one", label: "One", dark: "one-dark-pro", light: "one-light" },
	{ value: "plastic", label: "Plastic", dark: "plastic", light: PIERRE_LIGHT },
	{ value: "poimandres", label: "Poimandres", dark: "poimandres", light: PIERRE_LIGHT },
	{ value: "red", label: "Red", dark: "red", light: PIERRE_LIGHT },
	{ value: "rose-pine", label: "Rosé Pine", dark: "rose-pine", light: "rose-pine-dawn" },
	{
		value: "rose-pine-moon",
		label: "Rosé Pine Moon",
		dark: "rose-pine-moon",
		light: "rose-pine-dawn",
	},
	{ value: "slack", label: "Slack", dark: "slack-dark", light: "slack-ochin" },
	{ value: "snazzy-light", label: "Snazzy Light", dark: PIERRE_DARK, light: "snazzy-light" },
	{ value: "solarized", label: "Solarized", dark: "solarized-dark", light: "solarized-light" },
	{ value: "synthwave-84", label: "Synthwave '84", dark: "synthwave-84", light: PIERRE_LIGHT },
	{ value: "tokyo-night", label: "Tokyo Night", dark: "tokyo-night", light: PIERRE_LIGHT },
	{ value: "vesper", label: "Vesper", dark: "vesper", light: PIERRE_LIGHT },
	{ value: "vitesse", label: "Vitesse", dark: "vitesse-dark", light: "vitesse-light" },
	{ value: "vitesse-black", label: "Vitesse Black", dark: "vitesse-black", light: "vitesse-light" },
];

export const SYNTAX_THEME_OPTIONS = SYNTAX_THEMES.map(({ value, label }) => ({ value, label }));

const syntaxThemeMap = new Map(SYNTAX_THEMES.map((t) => [t.value, t]));

export function resolveSyntaxTheme(themeValue: string, mode: "dark" | "light"): string {
	const theme = syntaxThemeMap.get(themeValue);
	if (!theme) return mode === "dark" ? PIERRE_DARK : PIERRE_LIGHT;
	return theme[mode];
}
