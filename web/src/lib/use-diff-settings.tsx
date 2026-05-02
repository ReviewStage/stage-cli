import { createContext, type ReactNode, useCallback, useContext, useMemo } from "react";
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
}

const DiffSettingsContext = createContext<DiffSettingsContextValue | null>(null);

export function DiffSettingsProvider({ children }: { children: ReactNode }) {
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
	const [syntaxTheme, setSyntaxTheme] = useLocalStorage("diff-syntaxTheme", "pierre");

	const setViewModeStable = useCallback((mode: ViewMode) => setViewMode(mode), [setViewMode]);
	const setDiffIndicatorsStable = useCallback(
		(indicators: DiffIndicators) => setDiffIndicators(indicators),
		[setDiffIndicators],
	);
	const setLineDiffTypeStable = useCallback(
		(type: LineDiffType) => setLineDiffType(type),
		[setLineDiffType],
	);
	const setBackgroundsStable = useCallback(
		(enabled: boolean) => setBackgrounds(enabled),
		[setBackgrounds],
	);
	const setWrapStable = useCallback((next: boolean) => setWrap(next), [setWrap]);
	const setLineNumbersStable = useCallback(
		(enabled: boolean) => setLineNumbers(enabled),
		[setLineNumbers],
	);
	const setSyntaxThemeStable = useCallback(
		(theme: string) => setSyntaxTheme(theme),
		[setSyntaxTheme],
	);

	const value: DiffSettingsContextValue = useMemo(
		() => ({
			viewMode,
			setViewMode: setViewModeStable,
			diffIndicators,
			setDiffIndicators: setDiffIndicatorsStable,
			lineDiffType,
			setLineDiffType: setLineDiffTypeStable,
			backgrounds,
			setBackgrounds: setBackgroundsStable,
			wrap,
			setWrap: setWrapStable,
			lineNumbers,
			setLineNumbers: setLineNumbersStable,
			syntaxTheme,
			setSyntaxTheme: setSyntaxThemeStable,
		}),
		[
			viewMode,
			setViewModeStable,
			diffIndicators,
			setDiffIndicatorsStable,
			lineDiffType,
			setLineDiffTypeStable,
			backgrounds,
			setBackgroundsStable,
			wrap,
			setWrapStable,
			lineNumbers,
			setLineNumbersStable,
			syntaxTheme,
			setSyntaxThemeStable,
		],
	);

	return <DiffSettingsContext.Provider value={value}>{children}</DiffSettingsContext.Provider>;
}

export function useDiffSettings(): DiffSettingsContextValue {
	const context = useContext(DiffSettingsContext);
	if (!context) {
		throw new Error("useDiffSettings must be used within a DiffSettingsProvider");
	}
	return context;
}
