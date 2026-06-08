import {
	Bold,
	Code,
	FileDiff,
	Heading2,
	Italic,
	Link,
	List,
	ListChecks,
	ListOrdered,
	TextQuote,
} from "lucide-react";
import { type ComponentType, type RefObject, useEffect, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ToolbarAction {
	icon: ComponentType<{ className?: string }>;
	label: string;
	apply: (ctx: SelectionContext) => InsertResult;
	visibleFromClass?: string;
}

interface SelectionContext {
	value: string;
	selectionStart: number;
	selectionEnd: number;
}

interface InsertResult {
	value: string;
	selectionStart: number;
	selectionEnd: number;
}

function wrapSelection(
	ctx: SelectionContext,
	prefix: string,
	suffix: string,
	placeholder: string,
): InsertResult {
	const { value, selectionStart, selectionEnd } = ctx;
	const selected = value.slice(selectionStart, selectionEnd);
	const before = value.slice(0, selectionStart);
	const after = value.slice(selectionEnd);

	if (selected) {
		const wrapped = `${prefix}${selected}${suffix}`;
		return {
			value: `${before}${wrapped}${after}`,
			selectionStart: selectionStart + prefix.length,
			selectionEnd: selectionStart + prefix.length + selected.length,
		};
	}

	const inserted = `${prefix}${placeholder}${suffix}`;
	return {
		value: `${before}${inserted}${after}`,
		selectionStart: selectionStart + prefix.length,
		selectionEnd: selectionStart + prefix.length + placeholder.length,
	};
}

function prefixLine(ctx: SelectionContext, prefix: string, placeholder: string): InsertResult {
	const { value, selectionStart, selectionEnd } = ctx;
	const selected = value.slice(selectionStart, selectionEnd);
	const before = value.slice(0, selectionStart);
	const after = value.slice(selectionEnd);

	const needsNewline = before.length > 0 && !before.endsWith("\n");
	const needsTrailingNewline = after.length > 0 && !after.startsWith("\n");
	const linePrefix = needsNewline ? `\n${prefix}` : prefix;
	const trailingNewline = needsTrailingNewline ? "\n" : "";

	if (selected) {
		const lines = selected.split("\n");
		if (lines.length > 1 && lines[lines.length - 1] === "") {
			lines.pop();
		}
		const prefixed = lines.map((line) => `${prefix}${line}`).join("\n");
		const inserted = `${needsNewline ? "\n" : ""}${prefixed}`;
		return {
			value: `${before}${inserted}${trailingNewline}${after}`,
			selectionStart: selectionStart + (needsNewline ? 1 : 0),
			selectionEnd: selectionStart + inserted.length,
		};
	}

	const inserted = `${linePrefix}${placeholder}`;
	return {
		value: `${before}${inserted}${trailingNewline}${after}`,
		selectionStart: selectionStart + linePrefix.length,
		selectionEnd: selectionStart + linePrefix.length + placeholder.length,
	};
}

function insertBlock(
	ctx: SelectionContext,
	openFence: string,
	closeFence: string,
	placeholder: string,
): InsertResult {
	const { value, selectionStart, selectionEnd } = ctx;
	const selected = value.slice(selectionStart, selectionEnd);
	const before = value.slice(0, selectionStart);
	const after = value.slice(selectionEnd);

	const needsNewline = before.length > 0 && !before.endsWith("\n");
	const needsTrailingNewline = after.length > 0 && !after.startsWith("\n");
	const blockPrefix = needsNewline ? `\n${openFence}\n` : `${openFence}\n`;
	const rawContent = selected || placeholder;
	const content = rawContent.endsWith("\n") ? rawContent.slice(0, -1) : rawContent;
	const block = `${blockPrefix}${content}\n${closeFence}`;
	const trailingNewline = needsTrailingNewline ? "\n" : "";

	return {
		value: `${before}${block}${trailingNewline}${after}`,
		selectionStart: selectionStart + blockPrefix.length,
		selectionEnd: selectionStart + blockPrefix.length + content.length,
	};
}

interface ToolbarSeparator {
	key: string;
	visibleFromClass?: string;
}

type ToolbarItem = ToolbarAction | ToolbarSeparator;

const TOOLBAR_ITEMS: ToolbarItem[] = [
	{
		icon: FileDiff,
		label: "Suggestion",
		apply: (ctx) => insertBlock(ctx, "```suggestion", "```", "suggestion"),
	},
	{
		icon: Heading2,
		label: "Heading",
		apply: (ctx) => prefixLine(ctx, "## ", "heading"),
		visibleFromClass: "hidden @[13rem]:inline-flex",
	},
	{
		icon: Bold,
		label: "Bold",
		apply: (ctx) => wrapSelection(ctx, "**", "**", "bold text"),
	},
	{
		icon: Italic,
		label: "Italic",
		apply: (ctx) => wrapSelection(ctx, "_", "_", "italic text"),
	},
	{
		icon: TextQuote,
		label: "Quote",
		apply: (ctx) => prefixLine(ctx, "> ", "quote"),
		visibleFromClass: "hidden @[15rem]:inline-flex",
	},
	{
		icon: Code,
		label: "Code",
		apply: (ctx) => wrapSelection(ctx, "`", "`", "code"),
	},
	{
		icon: Link,
		label: "Link",
		apply: (ctx) => {
			const { value, selectionStart, selectionEnd } = ctx;
			const selected = value.slice(selectionStart, selectionEnd);
			const before = value.slice(0, selectionStart);
			const after = value.slice(selectionEnd);

			if (selected) {
				const inserted = `[${selected}](url)`;
				return {
					value: `${before}${inserted}${after}`,
					selectionStart: selectionStart + selected.length + 3,
					selectionEnd: selectionStart + selected.length + 6,
				};
			}

			const inserted = "[link text](url)";
			return {
				value: `${before}${inserted}${after}`,
				selectionStart: selectionStart + 1,
				selectionEnd: selectionStart + 10,
			};
		},
	},
	{ key: "list-separator", visibleFromClass: "hidden @[17rem]:block" },
	{
		icon: List,
		label: "Bulleted list",
		apply: (ctx) => prefixLine(ctx, "- ", "list item"),
		visibleFromClass: "hidden @[17rem]:inline-flex",
	},
	{
		icon: ListOrdered,
		label: "Numbered list",
		apply: (ctx) => prefixLine(ctx, "1. ", "list item"),
		visibleFromClass: "hidden @[19rem]:inline-flex",
	},
	{
		icon: ListChecks,
		label: "Task list",
		apply: (ctx) => prefixLine(ctx, "- [ ] ", "task"),
		visibleFromClass: "hidden @[21rem]:inline-flex",
	},
];

interface MarkdownToolbarProps {
	textareaRef: RefObject<HTMLTextAreaElement | null>;
	onChange: (value: string) => void;
	showSuggestion?: boolean;
	disabled?: boolean;
	className?: string;
}

export function MarkdownToolbar({
	textareaRef,
	onChange,
	showSuggestion = true,
	disabled = false,
	className,
}: MarkdownToolbarProps) {
	// Suppress tooltips briefly after mount so they don't flash when a parent
	// popover opens beneath the cursor.
	const [tooltipsReady, setTooltipsReady] = useState(false);
	useEffect(() => {
		const id = setTimeout(() => setTooltipsReady(true), 400);
		return () => clearTimeout(id);
	}, []);

	function handleAction(action: ToolbarAction) {
		const textarea = textareaRef.current;
		if (!textarea) return;

		const ctx: SelectionContext = {
			value: textarea.value,
			selectionStart: textarea.selectionStart,
			selectionEnd: textarea.selectionEnd,
		};

		const result = action.apply(ctx);
		onChange(result.value);

		requestAnimationFrame(() => {
			textarea.focus();
			textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
		});
	}

	return (
		<div
			role="toolbar"
			aria-label="Markdown formatting"
			className={cn(
				"@container flex flex-nowrap items-center gap-0.5 overflow-hidden border-border border-b px-1 py-1.5",
				className,
			)}
		>
			{TOOLBAR_ITEMS.filter(
				(item) => showSuggestion || !("label" in item && item.label === "Suggestion"),
			).map((item) => {
				if (!("icon" in item)) {
					return (
						<div
							key={item.key}
							className={cn("mx-1 h-4 w-px shrink-0 bg-border", item.visibleFromClass)}
							aria-hidden="true"
						/>
					);
				}

				return (
					<Tooltip key={item.label}>
						<TooltipTrigger asChild>
							<button
								type="button"
								disabled={disabled}
								aria-label={item.label}
								className={cn(
									"items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
									item.visibleFromClass ?? "inline-flex",
								)}
								onMouseDown={(e) => {
									if (e.button !== 0) return;
									e.preventDefault();
									handleAction(item);
								}}
								onClick={(e) => {
									if (e.detail === 0) handleAction(item);
								}}
							>
								<item.icon className="size-3.5" />
							</button>
						</TooltipTrigger>
						{tooltipsReady && <TooltipContent side="top">{item.label}</TooltipContent>}
					</Tooltip>
				);
			})}
		</div>
	);
}
