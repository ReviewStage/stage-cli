import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CommentMarkdownEditor } from "./comment-markdown-editor";

interface CommentFormProps {
	/** Label for the primary submit button (e.g. "Comment", "Reply", "Update"). */
	label: string;
	onSubmit: (body: string) => void | Promise<void>;
	onCancel: () => void;
	placeholder?: string;
	error?: string | null;
	/** Pre-fill the textarea when editing an existing comment. */
	initialBody?: string;
	autoFocus?: boolean;
}

export function CommentForm({
	label,
	onSubmit,
	onCancel,
	placeholder = "Leave a comment",
	error,
	initialBody,
	autoFocus = true,
}: CommentFormProps) {
	const [body, setBody] = useState(initialBody ?? "");
	const [isSubmitting, setIsSubmitting] = useState(false);
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
				onChange={setBody}
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
				<div className="mt-2 flex items-center justify-end gap-2">
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
			</CommentMarkdownEditor>
		</div>
	);
}
