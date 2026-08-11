import { createContext, type ReactNode, useCallback, useContext, useMemo } from "react";
import {
	DEFAULT_DIFF_FONT_FAMILY,
	DEFAULT_DIFF_FONT_SIZE,
	DEFAULT_DIFF_LIGATURES,
	DEFAULT_DIFF_LINE_HEIGHT,
	type DiffFontSize,
	type DiffLineHeight,
	isDiffFontFamily,
	isDiffFontSize,
	isDiffLineHeight,
} from "./diff-typography";
import { DEFAULT_SYNTAX_THEME_BY_APP_THEME, isSyntaxThemeForAppTheme } from "./syntax-themes";
import { APP_THEME, useTheme } from "./theme";
import { useLocalStorage } from "./use-local-storage";

export const VIEW_MODE = {
	SPLIT: "split",
	UNIFIED: "unified",
} as const;
export type ViewMode = (typeof VIEW_MODE)[keyof typeof VIEW_MODE];

export const DIFF_INDICATORS = {
	CLASSIC: "classic",
	BARS: "bars",
	NONE: "none",
} as const;
export type DiffIndicators = (typeof DIFF_INDICATORS)[keyof typeof DIFF_INDICATORS];

export const LINE_DIFF_TYPE = {
	WORD_ALT: "word-alt",
	WORD: "word",
	CHAR: "char",
	NONE: "none",
} as const;
export type LineDiffType = (typeof LINE_DIFF_TYPE)[keyof typeof LINE_DIFF_TYPE];

const DARK_SYNTAX_THEME_KEY = "diff-syntaxTheme-dark";
const LIGHT_SYNTAX_THEME_KEY = "diff-syntaxTheme-light";

interface DiffSettingsContextValue {
	viewMode: ViewMode;
	setViewMode: (mode: ViewMode) => void;
	diffIndicators: DiffIndicators;
	setDiffIndicators: (indicators: DiffIndicators) => void;
	lineDiffType: LineDiffType;
	setLineDiffType: (type: LineDiffType) => void;
	backgrounds: boolean;
	setBackgrounds: (enabled: boolean) => void;
	wrap: boolean;
	setWrap: (wrap: boolean) => void;
	lineNumbers: boolean;
	setLineNumbers: (enabled: boolean) => void;
	syntaxTheme: string;
	setSyntaxTheme: (theme: string) => void;
	darkSyntaxTheme: string;
	lightSyntaxTheme: string;
	diffFontFamily: string;
	setDiffFontFamily: (family: string) => void;
	diffFontSize: DiffFontSize;
	setDiffFontSize: (size: DiffFontSize) => void;
	diffLineHeight: DiffLineHeight;
	setDiffLineHeight: (lineHeight: DiffLineHeight) => void;
	diffLigatures: boolean;
	setDiffLigatures: (enabled: boolean) => void;
	inlineCommentsMinimized: boolean;
	toggleInlineCommentsMinimized: () => void;
}

const DiffSettingsContext = createContext<DiffSettingsContextValue | null>(null);

export function DiffSettingsProvider({ children }: { children: ReactNode }) {
	const { appTheme } = useTheme();
	const [viewMode, setViewMode] = useLocalStorage<ViewMode>("diff-viewMode", VIEW_MODE.SPLIT);
	const [diffIndicators, setDiffIndicators] = useLocalStorage<DiffIndicators>(
		"diff-indicators",
		DIFF_INDICATORS.CLASSIC,
	);
	const [lineDiffType, setLineDiffType] = useLocalStorage<LineDiffType>(
		"diff-lineDiffType",
		LINE_DIFF_TYPE.WORD,
	);
	const [backgrounds, setBackgrounds] = useLocalStorage("diff-backgrounds", true);
	const [wrap, setWrap] = useLocalStorage("diff-wrap", true);
	const [lineNumbers, setLineNumbers] = useLocalStorage("diff-lineNumbers", true);
	// Light and dark each persist their own syntax theme so a pick in one mode
	// never affects the other. Validate on read so a stale or wrong-mode value
	// falls back to that mode's default.
	const [rawDarkSyntaxTheme, setDarkSyntaxTheme] = useLocalStorage(
		DARK_SYNTAX_THEME_KEY,
		DEFAULT_SYNTAX_THEME_BY_APP_THEME[APP_THEME.DARK],
	);
	const [rawLightSyntaxTheme, setLightSyntaxTheme] = useLocalStorage(
		LIGHT_SYNTAX_THEME_KEY,
		DEFAULT_SYNTAX_THEME_BY_APP_THEME[APP_THEME.LIGHT],
	);
	const darkSyntaxTheme = isSyntaxThemeForAppTheme(rawDarkSyntaxTheme, APP_THEME.DARK)
		? rawDarkSyntaxTheme
		: DEFAULT_SYNTAX_THEME_BY_APP_THEME[APP_THEME.DARK];
	const lightSyntaxTheme = isSyntaxThemeForAppTheme(rawLightSyntaxTheme, APP_THEME.LIGHT)
		? rawLightSyntaxTheme
		: DEFAULT_SYNTAX_THEME_BY_APP_THEME[APP_THEME.LIGHT];
	const syntaxTheme = appTheme === APP_THEME.DARK ? darkSyntaxTheme : lightSyntaxTheme;
	const setSyntaxTheme = useCallback(
		(theme: string) => {
			if (appTheme === APP_THEME.DARK) setDarkSyntaxTheme(theme);
			else setLightSyntaxTheme(theme);
		},
		[appTheme, setDarkSyntaxTheme, setLightSyntaxTheme],
	);
	// Validate on read (like font size and line height) so a stale stored family
	// — e.g. a preset since removed — keeps the Font select in sync with the
	// rendered fallback instead of showing an option that no longer exists.
	const [rawDiffFontFamily, setDiffFontFamily] = useLocalStorage(
		"diff-fontFamily",
		DEFAULT_DIFF_FONT_FAMILY,
	);
	const diffFontFamily = isDiffFontFamily(rawDiffFontFamily)
		? rawDiffFontFamily
		: DEFAULT_DIFF_FONT_FAMILY;
	// Validate on read (like line height) so a stale stored size keeps the Font
	// size select in sync with the clamped render rather than showing a value the
	// options no longer offer.
	const [rawDiffFontSize, setDiffFontSize] = useLocalStorage<string>(
		"diff-fontSize",
		DEFAULT_DIFF_FONT_SIZE,
	);
	const diffFontSize = isDiffFontSize(rawDiffFontSize) ? rawDiffFontSize : DEFAULT_DIFF_FONT_SIZE;
	// Validate on read so a stale stored key (e.g. an earlier "regular" preset)
	// falls back to the default instead of resolving to undefined downstream.
	const [rawDiffLineHeight, setDiffLineHeight] = useLocalStorage<string>(
		"diff-lineHeight",
		DEFAULT_DIFF_LINE_HEIGHT,
	);
	const diffLineHeight = isDiffLineHeight(rawDiffLineHeight)
		? rawDiffLineHeight
		: DEFAULT_DIFF_LINE_HEIGHT;
	const [diffLigatures, setDiffLigatures] = useLocalStorage(
		"diff-ligatures",
		DEFAULT_DIFF_LIGATURES,
	);
	const [inlineCommentsMinimized, setInlineCommentsMinimized] = useLocalStorage(
		"diff-inlineCommentsMinimized",
		false,
	);
	const toggleInlineCommentsMinimized = useCallback(
		() => setInlineCommentsMinimized((prev) => !prev),
		[setInlineCommentsMinimized],
	);

	const value: DiffSettingsContextValue = useMemo(
		() => ({
			viewMode,
			setViewMode,
			diffIndicators,
			setDiffIndicators,
			lineDiffType,
			setLineDiffType,
			backgrounds,
			setBackgrounds,
			wrap,
			setWrap,
			lineNumbers,
			setLineNumbers,
			syntaxTheme,
			setSyntaxTheme,
			darkSyntaxTheme,
			lightSyntaxTheme,
			diffFontFamily,
			setDiffFontFamily,
			diffFontSize,
			setDiffFontSize,
			diffLineHeight,
			setDiffLineHeight,
			diffLigatures,
			setDiffLigatures,
			inlineCommentsMinimized,
			toggleInlineCommentsMinimized,
		}),
		[
			viewMode,
			setViewMode,
			diffIndicators,
			setDiffIndicators,
			lineDiffType,
			setLineDiffType,
			backgrounds,
			setBackgrounds,
			wrap,
			setWrap,
			lineNumbers,
			setLineNumbers,
			syntaxTheme,
			setSyntaxTheme,
			darkSyntaxTheme,
			lightSyntaxTheme,
			diffFontFamily,
			setDiffFontFamily,
			diffFontSize,
			setDiffFontSize,
			diffLineHeight,
			setDiffLineHeight,
			diffLigatures,
			setDiffLigatures,
			inlineCommentsMinimized,
			toggleInlineCommentsMinimized,
		],
	);

	return <DiffSettingsContext value={value}>{children}</DiffSettingsContext>;
}

export function useDiffSettings(): DiffSettingsContextValue {
	const context = useContext(DiffSettingsContext);
	if (!context) {
		throw new Error("useDiffSettings must be used within a DiffSettingsProvider");
	}
	return context;
}
