import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CommentMarkdownEditor } from "./comment-markdown-editor";

interface CheckboxControl {
	checked: boolean;
	disabled?: boolean;
	onCheckedChange?: (checked: boolean) => void;
}

interface CommentFormControls {
	local?: CheckboxControl;
	startReview?: CheckboxControl;
}

interface CommentFormProps {
	/** Label for the primary submit button (e.g. "Comment", "Reply", "Update"). */
	label: string;
	onSubmit: (body: string) => void | Promise<void>;
	onCancel: () => void;
	placeholder?: string;
	error?: string | null;
	/** Pre-fill the textarea when editing an existing comment. */
	initialBody?: string;
	/** Reports each edit so a parent can persist an in-progress draft across remounts. */
	onBodyChange?: (body: string) => void;
	autoFocus?: boolean;
	/** Compact destination/review choices shown in the editor footer. */
	controls?: CommentFormControls;
	/** Enables suggested changes for a new line-anchored GitHub comment. */
	allowsSuggestedChanges?: boolean;
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
	controls,
	allowsSuggestedChanges = false,
}: CommentFormProps) {
	const [body, setBody] = useState(initialBody ?? "");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const localId = useId();
	const startReviewId = useId();
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
			await onSubmit(trimmed);
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
				showSuggestion={allowsSuggestedChanges && controls?.local?.checked !== true}
			>
				{error && <p className="mt-2 text-destructive text-xs">{error}</p>}
				<div className="mt-2 flex items-center justify-between gap-2">
					<div className="flex items-center gap-3">
						{controls?.local && (
							<FormCheckbox
								id={localId}
								label="Local"
								control={controls.local}
								disabled={isSubmitting}
							/>
						)}
						{controls?.startReview && (
							<FormCheckbox
								id={startReviewId}
								label="Start a review"
								control={controls.startReview}
								disabled={isSubmitting}
							/>
						)}
					</div>
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

function FormCheckbox({
	id,
	label,
	control,
	disabled,
}: {
	id: string;
	label: string;
	control: CheckboxControl;
	disabled: boolean;
}) {
	return (
		<label
			htmlFor={id}
			className="flex cursor-pointer select-none items-center gap-1.5 has-[:disabled]:cursor-not-allowed"
		>
			<Checkbox
				id={id}
				checked={control.checked}
				onCheckedChange={(checked) => control.onCheckedChange?.(checked === true)}
				disabled={disabled || control.disabled}
			/>
			<span className="text-muted-foreground text-xs">{label}</span>
		</label>
	);
}
