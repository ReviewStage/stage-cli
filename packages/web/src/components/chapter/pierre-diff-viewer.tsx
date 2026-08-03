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
import { ReviewThreadView } from "@/components/comments/review-thread";
import {
	buildCommentAnnotations,
	type CommentDraft,
	clearDraftBody,
	type DraftBodies,
	type DraftState,
	findDraftAt,
	isSameAnchor,
	readDraftBody,
	upsertDraft,
	writeDraftBody,
} from "@/lib/comment-drafts";
import { resolveCommentControls, useCommentPreferences } from "@/lib/comment-preferences";
import {
	type AnnotatedLineRef,
	COMMENT_SIDE,
	DIFF_SIDE,
	type LineRef,
	SIDE_TO_DIFF,
} from "@/lib/diff-types";
import { useReviewContext } from "@/lib/review-context";
import { resolveSyntaxTheme } from "@/lib/syntax-themes";
import { useDiffSettings } from "@/lib/use-diff-settings";
import type { ReviewThread as CommentThread } from "@/lib/use-review";
import { toSingleSideSelection, useTextSelection } from "@/lib/use-text-selection";
import { LineHighlightOverlay } from "./hunk-highlight-overlay";
import { TextSelectionPopup } from "./text-selection-popup";
import { getThreadHoverRange } from "./thread-hover-range";

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
	const diffHunks = useMemo(
		() => (fileDiff ? fileDiff.hunks : getSingularPatch(patch).hunks),
		[fileDiff, patch],
	);

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
	const comments = useReviewContext();
	const { createGitHubComment, createLocalThread } = comments;
	const { local, setLocal, setStartReview, startReview } = useCommentPreferences();
	const fileThreads = useMemo(
		() => (filePath ? (comments.threadsByFile.get(filePath) ?? []) : []),
		[comments.threadsByFile, filePath],
	);
	// In-progress comment composers, one per anchor row — several can be open at once.
	const [drafts, setDrafts] = useState<DraftState[]>([]);
	// Composer text indexed by anchor, kept in a ref so typing never rebuilds the
	// annotation list and a composer's text survives the remount that opening or
	// closing another draft can trigger.
	const draftBodiesRef = useRef<DraftBodies>(new Map());
	const { selectionInfo, clearSelection } = useTextSelection(diffContainerRef);

	// Hovering a thread highlights its anchored lines. Highlighting sets Pierre's
	// `selectedLines`, which makes Pierre fire `onLineSelected` — the ref lets us
	// tell that apart from a genuine drag so a hover doesn't open the composer.
	const [hoverLines, setHoverLines] = useState<SelectedLineRange | null>(null);
	const isHoveringRef = useRef(false);

	const lineAnnotations = useMemo(
		() => buildCommentAnnotations(fileThreads, drafts),
		[fileThreads, drafts],
	);

	// Open a composer at an anchor. A row holds at most one composer, so re-opening the
	// same (side, endLine) adopts the new range's startLine rather than duplicating it.
	const openDraft = useCallback((anchor: CommentDraft) => {
		setDrafts((prev) => upsertDraft(prev, anchor));
	}, []);

	const closeDraft = useCallback((draft: CommentDraft) => {
		clearDraftBody(draftBodiesRef.current, draft.side, draft.endLine);
		setDrafts((prev) => prev.filter((d) => !isSameAnchor(d, draft.side, draft.endLine)));
	}, []);

	const handleCreateComment = useCallback(
		async (draft: DraftState, body: string, isLocal: boolean, pending: boolean) => {
			if (!filePath) return;
			const setError = (error: string | null) =>
				setDrafts((prev) =>
					prev.map((d) => (isSameAnchor(d, draft.side, draft.endLine) ? { ...d, error } : d)),
				);
			setError(null);
			const anchor = {
				filePath,
				side: draft.side,
				startLine: draft.startLine,
				endLine: draft.endLine,
				body,
			};
			try {
				if (isLocal) await createLocalThread(anchor);
				else await createGitHubComment({ ...anchor, pending });
				closeDraft(draft);
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to add comment");
				throw err; // keep the composer open with the body intact
			}
		},
		[filePath, createLocalThread, createGitHubComment, closeDraft],
	);

	const handleThreadMouseEnter = useCallback((thread: CommentThread) => {
		isHoveringRef.current = true;
		setHoverLines(getThreadHoverRange(thread));
	}, []);

	const handleThreadMouseLeave = useCallback(() => {
		isHoveringRef.current = false;
		setHoverLines(null);
	}, []);

	const renderAnnotation = useCallback(
		(annotation: DiffLineAnnotation<CommentThread[]>): ReactNode => {
			const threads = annotation.metadata ?? [];
			const draft = findDraftAt(drafts, annotation.side, annotation.lineNumber);
			if (threads.length === 0 && !draft) return null;
			const controls =
				draft === undefined
					? null
					: resolveCommentControls(
							{ local, startReview },
							{
								canPushToReview: comments.canPushToReview,
								canWriteToGitHub: comments.canWriteToGitHub,
								hasPendingReview: comments.hasPendingReview,
								isGitHubAnchor: isGitHubReviewAnchor(diffHunks, draft),
							},
						);
			return (
				<div
					className="space-y-2 px-3 py-2 font-sans"
					style={{ maxWidth: "min(48rem, 90cqw)", whiteSpace: "normal" }}
				>
					{threads.map((thread) => (
						// biome-ignore lint/a11y/noStaticElementInteractions: hover only highlights the anchored lines, it's not an interactive control
						<div
							key={thread.id}
							onMouseEnter={() => handleThreadMouseEnter(thread)}
							onMouseLeave={handleThreadMouseLeave}
						>
							<ReviewThreadView
								model={{
									thread,
									githubAnchorEligible: isGitHubReviewAnchor(diffHunks, thread),
								}}
							/>
						</div>
					))}
					{draft && (
						// Pierre keys annotation rows by array index, so a row can be reused
						// for a different anchor when a draft is added/removed. Key the composer
						// by its anchor to force a clean remount (re-reading its own draft text)
						// instead of inheriting another composer's in-progress state.
						<CommentForm
							key={`draft-${draft.side}-${draft.endLine}`}
							label="Comment"
							allowsSuggestedChanges
							placeholder="Leave a comment…"
							error={draft.error}
							initialBody={readDraftBody(draftBodiesRef.current, draft.side, draft.endLine)}
							onBodyChange={(body) =>
								writeDraftBody(draftBodiesRef.current, draft.side, draft.endLine, body)
							}
							controls={{
								local: {
									checked: controls?.local === true,
									disabled: controls?.localDisabled,
									onCheckedChange: setLocal,
								},
								...(controls?.showStartReview
									? {
											startReview: {
												checked: controls.startReview,
												onCheckedChange: setStartReview,
											},
										}
									: {}),
							}}
							onSubmit={(body) =>
								handleCreateComment(
									draft,
									body,
									controls?.local === true,
									controls?.startReview === true,
								)
							}
							onCancel={() => closeDraft(draft)}
						/>
					)}
				</div>
			);
		},
		[
			drafts,
			comments.canPushToReview,
			comments.canWriteToGitHub,
			comments.hasPendingReview,
			diffHunks,
			local,
			startReview,
			setLocal,
			setStartReview,
			handleCreateComment,
			closeDraft,
			handleThreadMouseEnter,
			handleThreadMouseLeave,
		],
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
						openDraft({
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
		[openDraft],
	);

	const handleCommentFromSelection = useCallback(
		(range: SelectedLineRange) => {
			openDraft({
				side: range.side ?? DIFF_SIDE.ADDITIONS,
				startLine: range.start,
				endLine: range.end,
			});
			clearSelection();
		},
		[openDraft, clearSelection],
	);

	// Dragging across the line-number gutter selects a range and opens a composer for the
	// whole span. Several composers can be open at once, so this adds one rather than
	// replacing any already-open draft.
	const handleLineSelected = useCallback(
		(range: SelectedLineRange | null) => {
			// Bail only while hovering a thread, whose highlight also fires onLineSelected.
			if (isHoveringRef.current || !range) return;
			// A thread anchors to one side, so cross-side gutter drags are ignored.
			const selection = toSingleSideSelection(range);
			if (!selection) return;
			openDraft(selection);
		},
		[openDraft],
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
			onLineSelected: handleLineSelected,
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
			handleLineSelected,
		],
	);

	const sharedProps = {
		options,
		// Hover-highlight takes precedence over any parent-controlled selection.
		selectedLines: hoverLines ?? selectedLinesProp ?? null,
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

	// Show the popup whenever text is selected — several composers can be open at once,
	// so a text-selection comment is always available.
	const textSelectionPopup = selectionInfo ? (
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

/** GitHub line comments must start and end inside the same hunk in the PR diff. */
export function isGitHubReviewAnchor(hunks: Hunk[], anchor: CommentDraft): boolean {
	const startHunk = findContainingHunk(hunks, anchor.startLine, anchor.side);
	if (!startHunk) return false;
	return findContainingHunk(hunks, anchor.endLine, anchor.side) === startHunk;
}

/**
 * Re-export {@link getSingularPatch} so chapter parents can pre-compute hunks
 * without taking a direct dependency on `@pierre/diffs`.
 */
export { getSingularPatch };
