import { BookOpen, PanelLeft, PanelRight, PanelTop, Rows3 } from "lucide-react";
import type { ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";
import { useLocalStorage } from "./use-local-storage";

export const CHAPTER_VIEW_MODE = {
	PAGED: "paged",
	CONTINUOUS: "continuous",
} as const;
export type ChapterViewMode = (typeof CHAPTER_VIEW_MODE)[keyof typeof CHAPTER_VIEW_MODE];

export const PANEL_POSITION = {
	LEFT: "left",
	TOP: "top",
	RIGHT: "right",
} as const;
export type PanelPosition = (typeof PANEL_POSITION)[keyof typeof PANEL_POSITION];

const DEFAULT_CHAPTER_VIEW_MODE: ChapterViewMode = CHAPTER_VIEW_MODE.PAGED;

export const PANEL_POSITION_OPTIONS: {
	value: PanelPosition;
	label: string;
	icon: React.ComponentType<{ className?: string }>;
	ariaLabel: string;
}[] = [
	{ value: PANEL_POSITION.LEFT, label: "", icon: PanelLeft, ariaLabel: "Left" },
	{ value: PANEL_POSITION.TOP, label: "", icon: PanelTop, ariaLabel: "Top" },
	{ value: PANEL_POSITION.RIGHT, label: "", icon: PanelRight, ariaLabel: "Right" },
];

const CHAPTER_PANEL_POSITION_STORAGE_KEY = "chapter-panelPosition";
const CHAPTER_SHOW_WHAT_TO_REVIEW_STORAGE_KEY = "chapter-showWhatToReview";

export const CHAPTER_VIEW_MODE_OPTIONS: {
	value: ChapterViewMode;
	label: string;
	icon: React.ComponentType<{ className?: string }>;
	ariaLabel: string;
}[] = [
	{
		value: CHAPTER_VIEW_MODE.PAGED,
		label: "Page",
		icon: BookOpen,
		ariaLabel: "Page chapters",
	},
	{
		value: CHAPTER_VIEW_MODE.CONTINUOUS,
		label: "Scroll",
		icon: Rows3,
		ariaLabel: "Scroll chapters",
	},
];

const CHAPTER_VIEW_MODES = new Set<string>(Object.values(CHAPTER_VIEW_MODE));

function isChapterViewMode(value: string): value is ChapterViewMode {
	return CHAPTER_VIEW_MODES.has(value);
}

interface ChapterSettingsContextValue {
	panelPosition: PanelPosition;
	setPanelPosition: (position: PanelPosition) => void;
	showWhatToReview: boolean;
	setShowWhatToReview: (isVisible: boolean) => void;
	chapterViewMode: ChapterViewMode;
	setChapterViewMode: (mode: ChapterViewMode) => void;
}

const ChapterSettingsContext = createContext<ChapterSettingsContextValue | null>(null);

export function ChapterSettingsProvider({ children }: { children: ReactNode }) {
	const [panelPosition, setPanelPosition] = useLocalStorage<PanelPosition>(
		CHAPTER_PANEL_POSITION_STORAGE_KEY,
		PANEL_POSITION.LEFT,
	);
	const [showWhatToReview, setShowWhatToReview] = useLocalStorage<boolean>(
		CHAPTER_SHOW_WHAT_TO_REVIEW_STORAGE_KEY,
		true,
	);
	const [rawChapterViewMode, setChapterViewMode] = useLocalStorage<string>(
		"chapter-viewMode",
		DEFAULT_CHAPTER_VIEW_MODE,
	);
	const chapterViewMode = isChapterViewMode(rawChapterViewMode)
		? rawChapterViewMode
		: DEFAULT_CHAPTER_VIEW_MODE;

	const value: ChapterSettingsContextValue = useMemo(
		() => ({
			panelPosition,
			setPanelPosition,
			showWhatToReview,
			setShowWhatToReview,
			chapterViewMode,
			setChapterViewMode,
		}),
		[
			panelPosition,
			setPanelPosition,
			showWhatToReview,
			setShowWhatToReview,
			chapterViewMode,
			setChapterViewMode,
		],
	);

	return <ChapterSettingsContext value={value}>{children}</ChapterSettingsContext>;
}

export function useChapterSettings(): ChapterSettingsContextValue {
	const context = useContext(ChapterSettingsContext);
	if (!context) {
		throw new Error("useChapterSettings must be used within a ChapterSettingsProvider");
	}
	return context;
}
