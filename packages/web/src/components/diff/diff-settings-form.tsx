import { useMatchRoute, useNavigate, useParams } from "@tanstack/react-router";
import { Columns2, Rows3 } from "lucide-react";
import { ShortcutLabel } from "@/components/keyboard/shortcut-label";
import { SegmentedToggle } from "@/components/shared/segmented-toggle";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useChapterViewState } from "@/lib/chapter-view-state-context";
import { DIFF_FONT_OPTIONS, FONT_SIZE_OPTIONS, LINE_HEIGHT_OPTIONS } from "@/lib/diff-typography";
import { SYNTAX_THEME_OPTIONS_BY_APP_THEME } from "@/lib/syntax-themes";
import { TEXT_SIZE_OPTIONS } from "@/lib/text-size";
import { useTheme } from "@/lib/theme";
import {
	CHAPTER_VIEW_MODE,
	CHAPTER_VIEW_MODE_OPTIONS,
	type ChapterViewMode,
	useChapterSettings,
} from "@/lib/use-chapter-settings";
import {
	DIFF_INDICATORS,
	type DiffIndicators,
	LINE_DIFF_TYPE,
	type LineDiffType,
	useDiffSettings,
	VIEW_MODE,
	type ViewMode,
} from "@/lib/use-diff-settings";
import { useTextSize } from "@/lib/use-text-size";
import { cn } from "@/lib/utils";

interface DiffSettingsFormProps {
	compact?: boolean;
}

const INDICATOR_OPTIONS: { value: DiffIndicators; label: string }[] = [
	{ value: DIFF_INDICATORS.CLASSIC, label: "Classic (+/-)" },
	{ value: DIFF_INDICATORS.BARS, label: "Bars" },
	{ value: DIFF_INDICATORS.NONE, label: "None" },
];

const LINE_DIFF_OPTIONS: { value: LineDiffType; label: string; description: string }[] = [
	{
		value: LINE_DIFF_TYPE.WORD_ALT,
		label: "Word-Alt",
		description: "Highlight entire words with enhanced algorithm",
	},
	{
		value: LINE_DIFF_TYPE.WORD,
		label: "Word",
		description: "Highlight changed words within lines",
	},
	{
		value: LINE_DIFF_TYPE.CHAR,
		label: "Character",
		description: "Highlight individual character changes",
	},
	{ value: LINE_DIFF_TYPE.NONE, label: "None", description: "Show line-level changes only" },
];

export function DiffSettingsForm({ compact }: DiffSettingsFormProps) {
	const { appTheme } = useTheme();
	const { textSize, setTextSize } = useTextSize();
	const { chapterViewMode, setChapterViewMode } = useChapterSettings();
	const navigate = useNavigate();
	const matchRoute = useMatchRoute();
	const params = useParams({ strict: false });
	const chapterViewState = useChapterViewState();

	// When leaving continuous mode from the chapters reader, land on the
	// chapter that was active in the stream (hosted's ChapterViewState flow).
	const updateChapterViewMode = (value: ChapterViewMode) => {
		const runId = params.runId;
		if (
			chapterViewMode === CHAPTER_VIEW_MODE.CONTINUOUS &&
			value === CHAPTER_VIEW_MODE.PAGED &&
			chapterViewState &&
			typeof runId === "string" &&
			matchRoute({ to: "/runs/$runId/chapters" })
		) {
			void navigate({
				to: "/runs/$runId/chapters/$chapterNumber",
				params: {
					runId,
					chapterNumber: String(chapterViewState.activeContinuousChapterNumber),
				},
				replace: true,
				resetScroll: false,
			});
		}
		setChapterViewMode(value);
	};
	const {
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
	} = useDiffSettings();

	return (
		<div className={cn("space-y-4", compact && "space-y-3")}>
			{/* App-wide appearance — hosted keeps these on its preferences page; the CLI
			    has no settings page, so they live here in their own small group. */}
			<GroupLabel>Appearance</GroupLabel>

			{/* Text size — scales the whole app; the diff keeps its own size below */}
			<SettingRow label="Text size" compact={compact}>
				<SettingSelect value={textSize} onValueChange={setTextSize} options={TEXT_SIZE_OPTIONS} />
			</SettingRow>

			<GroupLabel>Diff display</GroupLabel>

			<SettingRow label="Chapter view" compact={compact}>
				<div className="w-[160px]">
					<SegmentedToggle<ChapterViewMode>
						value={chapterViewMode}
						onChange={updateChapterViewMode}
						options={CHAPTER_VIEW_MODE_OPTIONS}
					/>
				</div>
			</SettingRow>

			{/* Syntax theme follows the app's resolved light/dark mode */}
			<SettingRow label="Syntax theme" compact={compact}>
				<SettingSelect
					value={syntaxTheme}
					onValueChange={setSyntaxTheme}
					options={SYNTAX_THEME_OPTIONS_BY_APP_THEME[appTheme]}
				/>
			</SettingRow>

			{/* Diff font */}
			<SettingRow label="Font" compact={compact}>
				<SettingSelect
					value={diffFontFamily}
					onValueChange={setDiffFontFamily}
					options={DIFF_FONT_OPTIONS}
				/>
			</SettingRow>

			{/* Font size */}
			<SettingRow label="Font size" compact={compact}>
				<SettingSelect
					value={diffFontSize}
					onValueChange={setDiffFontSize}
					options={FONT_SIZE_OPTIONS}
				/>
			</SettingRow>

			{/* Line height — scales with the font size */}
			<SettingRow label="Line height" compact={compact}>
				<SettingSelect
					value={diffLineHeight}
					onValueChange={setDiffLineHeight}
					options={LINE_HEIGHT_OPTIONS}
				/>
			</SettingRow>

			{/* Ligatures */}
			<SettingRow label="Ligatures" compact={compact}>
				<Switch aria-label="Ligatures" checked={diffLigatures} onCheckedChange={setDiffLigatures} />
			</SettingRow>

			{/* View mode */}
			<SettingRow label="Layout" compact={compact}>
				<div className="w-[160px]">
					<SegmentedToggle<ViewMode>
						value={viewMode}
						onChange={setViewMode}
						options={[
							{ value: VIEW_MODE.UNIFIED, label: "Unified", icon: Rows3 },
							{ value: VIEW_MODE.SPLIT, label: "Split", icon: Columns2 },
						]}
					/>
				</div>
			</SettingRow>

			{/* Diff indicators */}
			<SettingRow label="Indicators" compact={compact}>
				<SettingSelect
					value={diffIndicators}
					onValueChange={setDiffIndicators}
					options={INDICATOR_OPTIONS}
				/>
			</SettingRow>

			{/* Inline diff type */}
			<SettingRow label="Inline diffs" compact={compact}>
				<SettingSelect
					value={lineDiffType}
					onValueChange={setLineDiffType}
					options={LINE_DIFF_OPTIONS}
				/>
			</SettingRow>

			{/* Backgrounds */}
			<SettingRow label="Backgrounds" compact={compact}>
				<Switch aria-label="Backgrounds" checked={backgrounds} onCheckedChange={setBackgrounds} />
			</SettingRow>

			{/* Line wrapping */}
			<SettingRow label="Wrapping" compact={compact}>
				<Switch aria-label="Wrapping" checked={wrap} onCheckedChange={setWrap} />
			</SettingRow>

			{/* Line numbers */}
			<SettingRow label="Line numbers" compact={compact}>
				<Switch aria-label="Line numbers" checked={lineNumbers} onCheckedChange={setLineNumbers} />
			</SettingRow>

			{/* Minimize inline comments */}
			<SettingRow
				label={
					<>
						Minimize inlines <ShortcutLabel label="i" />
					</>
				}
				compact={compact}
			>
				<Switch
					aria-label="Minimize inlines"
					checked={inlineCommentsMinimized}
					onCheckedChange={() => toggleInlineCommentsMinimized()}
				/>
			</SettingRow>
		</div>
	);
}

function GroupLabel({ children }: { children: React.ReactNode }) {
	return (
		<h3 className="pt-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wider first:pt-0">
			{children}
		</h3>
	);
}

function SettingRow({
	label,
	compact,
	children,
}: {
	label: React.ReactNode;
	compact?: boolean;
	children: React.ReactNode;
}) {
	return (
		<div className={cn("flex min-h-8 items-center justify-between", compact ? "gap-4" : "gap-6")}>
			<Label className="text-sm font-medium">{label}</Label>
			{children}
		</div>
	);
}

function SettingSelect<T extends string>({
	value,
	onValueChange,
	options,
}: {
	value: T;
	onValueChange: (value: T) => void;
	options: { value: T; label: string; description?: string }[];
}) {
	function isValidOption(v: string): v is T {
		return options.some((opt) => opt.value === v);
	}

	return (
		<Select
			value={value}
			onValueChange={(v) => {
				if (isValidOption(v)) {
					onValueChange(v);
				}
			}}
		>
			<SelectTrigger size="sm" className="w-[160px]">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{options.map((opt) => (
					<SelectItem key={opt.value} value={opt.value} description={opt.description}>
						{opt.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
