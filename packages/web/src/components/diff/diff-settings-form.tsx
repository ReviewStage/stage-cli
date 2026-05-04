import { Columns2, Rows3 } from "lucide-react";
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
import { SYNTAX_THEME_OPTIONS } from "@/lib/syntax-themes";
import {
	DIFF_INDICATORS,
	type DiffIndicators,
	LINE_DIFF_TYPE,
	type LineDiffType,
	useDiffSettings,
	VIEW_MODE,
	type ViewMode,
} from "@/lib/use-diff-settings";
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
	} = useDiffSettings();

	return (
		<div className={cn("space-y-4", compact && "space-y-3")}>
			{/* Syntax theme */}
			<SettingRow label="Syntax theme" compact={compact}>
				<SettingSelect
					value={syntaxTheme}
					onValueChange={setSyntaxTheme}
					options={SYNTAX_THEME_OPTIONS}
				/>
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
				<Switch checked={backgrounds} onCheckedChange={setBackgrounds} />
			</SettingRow>

			{/* Line wrapping */}
			<SettingRow label="Wrapping" compact={compact}>
				<Switch checked={wrap} onCheckedChange={setWrap} />
			</SettingRow>

			{/* Line numbers */}
			<SettingRow label="Line numbers" compact={compact}>
				<Switch checked={lineNumbers} onCheckedChange={setLineNumbers} />
			</SettingRow>
		</div>
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
