import { type KeyboardEvent, type ReactNode, type RefObject, useState } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { Markdown } from "@/components/ui/markdown";
import { cn } from "@/lib/utils";
import { MarkdownToolbar } from "./markdown-toolbar";

const EDITOR_MODE = {
	WRITE: "write",
	PREVIEW: "preview",
} as const;
type EditorMode = (typeof EDITOR_MODE)[keyof typeof EDITOR_MODE];
const EDITOR_MODE_LABEL: Record<EditorMode, string> = {
	[EDITOR_MODE.WRITE]: "Write",
	[EDITOR_MODE.PREVIEW]: "Preview",
};

interface CommentMarkdownEditorProps {
	value: string;
	onChange: (value: string) => void;
	textareaRef: RefObject<HTMLTextAreaElement | null>;
	placeholder: string;
	disabled?: boolean;
	minRows?: number;
	maxRows?: number;
	className?: string;
	textareaClassName?: string;
	previewClassName?: string;
	onKeyDown?: (event: KeyboardEvent) => void;
	children?: ReactNode;
}

export function CommentMarkdownEditor({
	value,
	onChange,
	textareaRef,
	placeholder,
	disabled = false,
	minRows = 2,
	maxRows,
	className,
	textareaClassName,
	previewClassName,
	onKeyDown,
	children,
}: CommentMarkdownEditorProps) {
	const [mode, setMode] = useState<EditorMode>(EDITOR_MODE.WRITE);

	return (
		<fieldset className={className} onKeyDown={onKeyDown}>
			<div className="flex min-w-0 items-center justify-between gap-2 overflow-hidden border-border border-b">
				<div className="flex shrink-0 items-center gap-1 px-2">
					{Object.values(EDITOR_MODE).map((nextMode) => {
						const isActive = mode === nextMode;
						return (
							<button
								key={nextMode}
								type="button"
								aria-pressed={isActive}
								onClick={() => setMode(nextMode)}
								className={cn(
									"rounded-md px-2 py-1 font-medium text-xs transition-colors",
									isActive
										? "bg-muted text-foreground"
										: "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
								)}
							>
								{EDITOR_MODE_LABEL[nextMode]}
							</button>
						);
					})}
				</div>
				{/* Suggestion blocks only apply on a PR, so omit that toolbar item for local comments. */}
				<MarkdownToolbar
					textareaRef={textareaRef}
					showSuggestion={false}
					disabled={disabled || mode === EDITOR_MODE.PREVIEW}
					onChange={onChange}
					className="min-w-0 flex-1 justify-end border-b-0 py-1 pr-1 pl-0"
				/>
			</div>
			<div className="p-3">
				<TextareaAutosize
					ref={textareaRef}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					placeholder={placeholder}
					disabled={disabled}
					minRows={minRows}
					maxRows={maxRows}
					className={cn(
						"w-full resize-none bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none disabled:opacity-50",
						mode === EDITOR_MODE.PREVIEW && "hidden",
						textareaClassName,
					)}
				/>
				{mode === EDITOR_MODE.PREVIEW &&
					(value.trim().length > 0 ? (
						<Markdown content={value} className={cn("min-h-[2.5rem]", previewClassName)} />
					) : (
						<p className={cn("min-h-[2.5rem] text-muted-foreground text-sm", previewClassName)}>
							Nothing to preview
						</p>
					))}
				{children}
			</div>
		</fieldset>
	);
}
