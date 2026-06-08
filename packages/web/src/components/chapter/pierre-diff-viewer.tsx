import {
	type DiffLineAnnotation,
	type FileDiffMetadata,
	type GetHoveredLineResult,
	getSingularPatch,
	type Hunk,
	type SelectedLineRange,
} from "@pierre/diffs";
import { FileDiff, PatchDiff } from "@pierre/diffs/react";
import { Plus } from "lucide-react";
import {
	type CSSProperties,
	type ReactNode,
	useCallback,
	useDeferredValue,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { CommentForm } from "@/components/comments/comment-form";
import { CommentThreadView } from "@/components/comments/comment-thread";
import { useCommentThreadsContext } from "@/lib/comment-threads-context";
import {
	type AnnotatedLineRef,
	COMMENT_SIDE,
	DIFF_SIDE,
	type DiffSide,
	type LineRef,
	SIDE_TO_DIFF,
} from "@/lib/diff-types";
import { resolveSyntaxTheme } from "@/lib/syntax-themes";
import type { CommentThread } from "@/lib/use-comment-threads";
import { useDiffSettings } from "@/lib/use-diff-settings";
import { useTextSelection } from "@/lib/use-text-selection";
import { LineHighlightOverlay } from "./hunk-highlight-overlay";
import { TextSelectionPopup } from "./text-selection-popup";

type AppTheme = "light" | "dark";

function detectAppTheme(): AppTheme {
	if (typeof document === "undefined") return "light";
	return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function useAppTheme(override?: AppTheme): AppTheme {
	const [theme, setTheme] = useState<AppTheme>(() => override ?? detectAppTheme());

	useEffect(() => {
		if (override) {
			setTheme(override);
			return;
		}
		if (typeof document === "undefined") return;

		const update = () => setTheme(detectAppTheme());
		update();
		const observer = new MutationObserver(update);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class"],
		});
		return () => observer.disconnect();
	}, [override]);

	return theme;
}

/**
 * Computes the first and last addition-side line numbers that are actually
 * rendered in the diff DOM. Lines between hunks are collapsed and don't have
 * DOM nodes, so we must use real hunk boundaries.
 *
 * Returns `null` when hunks are non-contiguous (Pierre cannot resolve a range
 * that spans collapsed lines between hunks) or when the addition side has no
 * lines (deletion-only hunks, e.g. fully-deleted files).
 */
export function getVisibleLineRange(
	hunks: Hunk[],
	expandUnchanged = false,
): { first: number; last: number } | null {
	if (hunks.length === 0) return null;
	if (!expandUnchanged) {
		for (let i = 1; i < hunks.length; i++) {
			const prev = hunks[i - 1];
			const curr = hunks[i];
			if (!prev || !curr) continue;
			const prevEnd = prev.additionStart + prev.additionCount;
			if (curr.additionStart !== prevEnd) return null;
		}
	}
	const firstHunk = hunks[0];
	const lastHunk = hunks[hunks.length - 1];
	if (!firstHunk || !lastHunk) return null;
	if (firstHunk.additionCount === 0 || lastHunk.additionCount === 0) return null;
	return {
		first: firstHunk.additionStart,
		last: lastHunk.additionStart + lastHunk.additionCount - 1,
	};
}

interface CommentDraft {
	side: DiffSide;
	startLine: number;
	endLine: number;
}

// Groups threads (plus any in-progress draft) by their anchor line so Pierre
// renders one annotation row per (side, line) directly below the diff line.
function buildCommentAnnotations(
	threads: CommentThread[],
	draft: CommentDraft | null,
): DiffLineAnnotation<CommentThread[]>[] {
	const bySideLine = new Map<DiffSide, Map<number, DiffLineAnnotation<CommentThread[]>>>();
	const ensure = (side: DiffSide, line: number): DiffLineAnnotation<CommentThread[]> => {
		let byLine = bySideLine.get(side);
		if (!byLine) {
			byLine = new Map();
			bySideLine.set(side, byLine);
		}
		let entry = byLine.get(line);
		if (!entry) {
			entry = { side, lineNumber: line, metadata: [] };
			byLine.set(line, entry);
		}
		return entry;
	};
	for (const thread of threads) ensure(thread.side, thread.endLine).metadata.push(thread);
	if (draft) ensure(draft.side, draft.endLine);
	const out: DiffLineAnnotation<CommentThread[]>[] = [];
	for (const byLine of bySideLine.values()) {
		for (const entry of byLine.values()) out.push(entry);
	}
	return out;
}

type PierreDiffViewerProps = {
	filePath?: string;
	selectedLines?: SelectedLineRange | null;
	expandUnchanged?: boolean;
	/** All key change line refs grouped by file path. */
	allLineRefsByFile?: Map<string, AnnotatedLineRef[]> | null;
	/** Currently focused key change line refs grouped by file path. */
	focusedLineRefsByFile?: Map<string, LineRef[]> | null;
	focusedKeyChangeId?: string | null;
	isKeyChangeChecked?: (keyChangeId: string) => boolean;
	onMarkKeyChangeChecked?: (keyChangeId: string) => void;
	onUnmarkKeyChangeChecked?: (keyChangeId: string) => void;
	onFocusKeyChange?: (keyChangeId: string | null, scrollTarget?: LineRef | null) => void;
	/** Force a specific theme. Defaults to detecting `.dark` on `<html>`. */
	appTheme?: AppTheme;
} & ({ patch: string; fileDiff?: never } | { patch?: never; fileDiff: FileDiffMetadata });

const noop = () => {};
const noopChecked = () => false;

// Literal styles for the hover "+" — see renderGutterUtility for why Tailwind
// utilities can't be used here. `backgroundColor` is Tailwind blue-500's value.
const GUTTER_SLOT_STYLE: CSSProperties = {
	display: "flex",
	height: "100%",
	alignItems: "flex-start",
	justifyContent: "center",
	paddingTop: "2px",
};
const GUTTER_BUTTON_STYLE: CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	width: "16px",
	height: "16px",
	borderRadius: "4px",
	backgroundColor: "oklch(62.3% 0.214 259.815)",
	color: "#fff",
	cursor: "pointer",
};

export function PierreDiffViewer({
	patch,
	fileDiff,
	filePath,
	selectedLines: selectedLinesProp,
	expandUnchanged = false,
	allLineRefsByFile,
	focusedLineRefsByFile,
	focusedKeyChangeId = null,
	isKeyChangeChecked,
	onMarkKeyChangeChecked,
	onUnmarkKeyChangeChecked,
	onFocusKeyChange,
	appTheme: appThemeProp,
}: PierreDiffViewerProps) {
	const appTheme = useAppTheme(appThemeProp);
	const { viewMode, diffIndicators, lineDiffType, backgrounds, wrap, lineNumbers, syntaxTheme } =
		useDiffSettings();

	// Defer settings so UI controls update instantly while the expensive diff
	// re-renders at lower priority.
	const deferredViewMode = useDeferredValue(viewMode);
	const deferredIndicators = useDeferredValue(diffIndicators);
	const deferredLineDiffType = useDeferredValue(lineDiffType);
	const deferredBackgrounds = useDeferredValue(backgrounds);
	const deferredWrap = useDeferredValue(wrap);
	const deferredLineNumbers = useDeferredValue(lineNumbers);
	const deferredSyntaxTheme = useDeferredValue(syntaxTheme);
	const deferredExpandUnchanged = useDeferredValue(expandUnchanged);

	const diffContainerRef = useRef<HTMLDivElement>(null);

	const focusedLineRefs = useMemo(() => {
		if (!focusedLineRefsByFile || !filePath) return undefined;
		return focusedLineRefsByFile.get(filePath);
	}, [focusedLineRefsByFile, filePath]);

	const allAnnotatedLineRefs = useMemo(() => {
		if (!allLineRefsByFile || !filePath) return undefined;
		return allLineRefsByFile.get(filePath);
	}, [allLineRefsByFile, filePath]);

	// ---- Line-anchored comments ----
	const comments = useCommentThreadsContext();
	const { createThread } = comments;
	const fileThreads = useMemo(
		() => (filePath ? (comments.threadsByFile.get(filePath) ?? []) : []),
		[comments.threadsByFile, filePath],
	);
	// The line range the user is composing a new comment on (null when idle).
	const [draft, setDraft] = useState<CommentDraft | null>(null);
	const [draftError, setDraftError] = useState<string | null>(null);
	const { selectionInfo, clearSelection } = useTextSelection(diffContainerRef);

	const lineAnnotations = useMemo(
		() => buildCommentAnnotations(fileThreads, draft),
		[fileThreads, draft],
	);

	const cancelDraft = useCallback(() => {
		setDraft(null);
		setDraftError(null);
	}, []);

	const handleCreateComment = useCallback(
		async (body: string) => {
			if (!draft || !filePath) return;
			setDraftError(null);
			try {
				await createThread({
					filePath,
					side: draft.side,
					startLine: draft.startLine,
					endLine: draft.endLine,
					body,
				});
				setDraft(null);
			} catch (err) {
				setDraftError(err instanceof Error ? err.message : "Failed to add comment");
				throw err; // keep the composer open with the body intact
			}
		},
		[draft, filePath, createThread],
	);

	const renderAnnotation = useCallback(
		(annotation: DiffLineAnnotation<CommentThread[]>): ReactNode => {
			const threads = annotation.metadata ?? [];
			const showComposer =
				draft !== null && annotation.side === draft.side && annotation.lineNumber === draft.endLine;
			if (threads.length === 0 && !showComposer) return null;
			return (
				<div
					className="space-y-2 px-3 py-2 font-sans"
					style={{ maxWidth: "min(48rem, 90cqw)", whiteSpace: "normal" }}
				>
					{threads.map((thread) => (
						<CommentThreadView key={thread.id} thread={thread} />
					))}
					{showComposer && (
						<CommentForm
							label="Comment"
							placeholder="Leave a comment…"
							error={draftError}
							onSubmit={handleCreateComment}
							onCancel={cancelDraft}
						/>
					)}
				</div>
			);
		},
		[draft, draftError, handleCreateComment, cancelDraft],
	);

	const renderGutterUtility = useCallback(
		(getHoveredLine: () => GetHoveredLineResult<"diff"> | undefined): ReactNode => (
			// Pierre projects this into its shadow DOM via a <slot>, and slotted content
			// inherits custom properties from the shadow tree, not the light-DOM :root.
			// Tailwind v4 utilities resolve through `--color-*`/`--spacing`/`--radius`
			// vars that aren't defined there, so they'd compute to transparent/zero.
			// Style with literal values (blue-500 = the resolved `--color-blue-500`).
			<div style={GUTTER_SLOT_STYLE}>
				<button
					type="button"
					aria-label="Add comment"
					style={GUTTER_BUTTON_STYLE}
					onClick={() => {
						const hovered = getHoveredLine();
						if (!hovered) return;
						setDraftError(null);
						setDraft({
							side: hovered.side,
							startLine: hovered.lineNumber,
							endLine: hovered.lineNumber,
						});
					}}
				>
					<Plus size={12} strokeWidth={3} />
				</button>
			</div>
		),
		[],
	);

	const handleCommentFromSelection = useCallback(
		(range: SelectedLineRange) => {
			setDraftError(null);
			setDraft({
				side: range.side ?? DIFF_SIDE.ADDITIONS,
				startLine: range.start,
				endLine: range.end,
			});
			clearSelection();
		},
		[clearSelection],
	);

	const options = useMemo(
		() => ({
			theme: resolveSyntaxTheme(deferredSyntaxTheme, appTheme),
			themeType: appTheme,
			diffStyle: deferredViewMode,
			diffIndicators: deferredIndicators,
			lineDiffType: deferredLineDiffType,
			disableBackground: !deferredBackgrounds,
			disableFileHeader: true,
			disableLineNumbers: !deferredLineNumbers,
			expandUnchanged: deferredExpandUnchanged,
			expansionLineCount: 20,
			overflow: deferredWrap ? ("wrap" as const) : ("scroll" as const),
			enableLineSelection: true,
			enableGutterUtility: true,
		}),
		[
			appTheme,
			deferredSyntaxTheme,
			deferredViewMode,
			deferredIndicators,
			deferredLineDiffType,
			deferredBackgrounds,
			deferredWrap,
			deferredLineNumbers,
			deferredExpandUnchanged,
		],
	);

	const sharedProps = {
		options,
		selectedLines: selectedLinesProp ?? null,
		lineAnnotations,
		renderAnnotation,
		renderGutterUtility,
	};

	// Only mount the overlay when this file actually has refs to highlight.
	// The overlay's click-listener effect polls for Pierre's shadow root on
	// mount, so leaving it on for every diff (e.g. plain /files view, chapter
	// files with no key changes) adds unnecessary work per file.
	const hasLineRefs = (allAnnotatedLineRefs?.length ?? 0) > 0 || (focusedLineRefs?.length ?? 0) > 0;
	const overlay = hasLineRefs ? (
		<LineHighlightOverlay
			allLineRefs={allAnnotatedLineRefs}
			focusedLineRefs={focusedLineRefs}
			focusedKeyChangeId={focusedKeyChangeId}
			isKeyChangeChecked={isKeyChangeChecked ?? noopChecked}
			onMarkKeyChangeChecked={onMarkKeyChangeChecked ?? noop}
			onUnmarkKeyChangeChecked={onUnmarkKeyChangeChecked ?? noop}
			onFocusKeyChange={onFocusKeyChange ?? noop}
			containerRef={diffContainerRef}
		/>
	) : null;

	// Only show the popup when text is selected and no composer is already open.
	const textSelectionPopup =
		selectionInfo && draft === null ? (
			<TextSelectionPopup
				selectionRect={selectionInfo.rect}
				lineRange={selectionInfo.lineRange}
				onComment={handleCommentFromSelection}
			/>
		) : null;

	if (fileDiff) {
		return (
			<div
				className="@container/diff relative isolate overflow-hidden rounded-b-lg border-x border-b border-border"
				ref={diffContainerRef}
			>
				<FileDiff<CommentThread[]> fileDiff={fileDiff} {...sharedProps} />
				{overlay}
				{textSelectionPopup}
			</div>
		);
	}

	return (
		<div
			className="@container/diff relative isolate overflow-hidden rounded-b-lg border-x border-b border-border"
			ref={diffContainerRef}
		>
			<PatchDiff<CommentThread[]> patch={patch} {...sharedProps} />
			{overlay}
			{textSelectionPopup}
		</div>
	);
}

/**
 * Re-exported helper for chapter container components: derive the addition-side
 * line range that covers a key change's hunks. Uses {@link getVisibleLineRange}
 * to clamp to the rendered surface and bail when hunks are non-contiguous.
 */
export function getKeyChangeFileLineRange(
	hunks: Hunk[],
	expandUnchanged = false,
): SelectedLineRange | null {
	const visibleRange = getVisibleLineRange(hunks, expandUnchanged);
	if (!visibleRange) return null;
	return {
		start: visibleRange.first,
		side: SIDE_TO_DIFF[COMMENT_SIDE.RIGHT],
		end: visibleRange.last,
		endSide: SIDE_TO_DIFF[COMMENT_SIDE.RIGHT],
	};
}

/**
 * Look up the hunk containing a line on the addition or deletion side. Useful
 * for parents that need to clamp a selection to its hunk before passing it in.
 */
export function findContainingHunk(
	hunks: Hunk[],
	line: number,
	side: (typeof DIFF_SIDE)[keyof typeof DIFF_SIDE],
): Hunk | undefined {
	return hunks.find((hunk) => {
		const start = side === DIFF_SIDE.ADDITIONS ? hunk.additionStart : hunk.deletionStart;
		const count = side === DIFF_SIDE.ADDITIONS ? hunk.additionCount : hunk.deletionCount;
		return line >= start && line < start + count;
	});
}

/**
 * Re-export {@link getSingularPatch} so chapter parents can pre-compute hunks
 * without taking a direct dependency on `@pierre/diffs`.
 */
export { getSingularPatch };
