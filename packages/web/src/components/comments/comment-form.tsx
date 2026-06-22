import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CommentMarkdownEditor } from "./comment-markdown-editor";

interface CommentFormProps {
	/** Label for the primary submit button (e.g. "Comment", "Reply", "Update"). */
	label: string;
	/** `toggleOn` carries the optional checkbox state; it's `true` when no toggle is shown. */
	onSubmit: (body: string, toggleOn: boolean) => void | Promise<void>;
	onCancel: () => void;
	placeholder?: string;
	error?: string | null;
	/** Pre-fill the textarea when editing an existing comment. */
	initialBody?: string;
	/** Reports each edit so a parent can persist an in-progress draft across remounts. */
	onBodyChange?: (body: string) => void;
	autoFocus?: boolean;
	/** When set, renders a checkbox (e.g. "Comment on the PR") whose state is passed to onSubmit. */
	toggleLabel?: string;
	toggleDefault?: boolean;
}

export function CommentForm({
	label,
	onSubmit,
	onCancel,
	placeholder = "Leave a comment",
	error,
	initialBody,
	onBodyChange,
	autoFocus = true,
	toggleLabel,
	toggleDefault = true,
}: CommentFormProps) {
	const [body, setBody] = useState(initialBody ?? "");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [toggleOn, setToggleOn] = useState(toggleDefault);
	const toggleId = useId();
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const submittingRef = useRef(false);
	const hasContent = body.trim().length > 0;

	useEffect(() => {
		if (!autoFocus) return;
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.focus();
		textarea.selectionStart = textarea.value.length;
		textarea.selectionEnd = textarea.value.length;
	}, [autoFocus]);

	async function runSubmit() {
		const trimmed = body.trim();
		if (!trimmed || submittingRef.current) return;
		submittingRef.current = true;
		setIsSubmitting(true);
		try {
			await onSubmit(trimmed, toggleLabel === undefined ? true : toggleOn);
			setBody("");
		} catch {
			// The caller surfaces the error; preserve the body so the user can retry.
		} finally {
			submittingRef.current = false;
			setIsSubmitting(false);
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			void runSubmit();
		}
		if (e.key === "Escape") {
			e.preventDefault();
			onCancel();
		}
	}

	return (
		<div className="animate-in fade-in-0 slide-in-from-bottom-1 duration-150">
			<CommentMarkdownEditor
				value={body}
				onChange={(value) => {
					setBody(value);
					onBodyChange?.(value);
				}}
				textareaRef={textareaRef}
				disabled={isSubmitting}
				placeholder={placeholder}
				onKeyDown={handleKeyDown}
				minRows={2}
				maxRows={12}
				className="rounded-xl border border-border bg-card transition-shadow has-[textarea:focus-visible]:border-ring has-[textarea:focus-visible]:ring-2 has-[textarea:focus-visible]:ring-ring/20"
				textareaClassName="max-h-[12rem] overflow-y-auto"
				previewClassName="max-h-[12rem] overflow-y-auto"
			>
				{error && <p className="mt-2 text-destructive text-xs">{error}</p>}
				<div className="mt-2 flex items-center justify-between gap-2">
					{toggleLabel !== undefined ? (
						<label
							htmlFor={toggleId}
							className="flex cursor-pointer select-none items-center gap-1.5"
						>
							<Checkbox
								id={toggleId}
								checked={toggleOn}
								onCheckedChange={(checked) => setToggleOn(checked === true)}
								disabled={isSubmitting}
							/>
							<span className="text-muted-foreground text-xs">{toggleLabel}</span>
						</label>
					) : (
						<div />
					)}
					<div className="flex items-center gap-2">
						<Button variant="ghost" size="sm" onClick={onCancel} disabled={isSubmitting}>
							Cancel
						</Button>
						<Button
							size="sm"
							variant={hasContent ? "default" : "secondary"}
							onClick={() => void runSubmit()}
							disabled={!hasContent || isSubmitting}
						>
							{isSubmitting ? "Submitting…" : label}
						</Button>
					</div>
				</div>
			</CommentMarkdownEditor>
		</div>
	);
}
