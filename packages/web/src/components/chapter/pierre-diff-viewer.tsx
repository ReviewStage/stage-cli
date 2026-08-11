import {
	type FileDiffMetadata,
	type GetHoveredLineResult,
	getLineAnnotationName,
	getSingularPatch,
	type Hunk,
	type SelectedLineRange,
} from "@pierre/diffs";
import { FileDiff, PatchDiff } from "@pierre/diffs/react";
import type { LineAnchoredReviewThread } from "@stagereview/types/review";
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
import { MinimizedAnnotationIndicator } from "@/components/diff/minimized-annotation-indicator";
import { useFileCommentDrafts } from "@/lib/comment-draft-store";
import {
	buildCommentAnnotations,
	type CommentAnnotation,
	type CommentDraft,
	clearDraftBody,
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
	type DiffSide,
	type LineRef,
	SIDE_TO_DIFF,
} from "@/lib/diff-types";
import {
	resolveFontFamily,
	resolveFontFeatures,
	resolveFontSize,
	resolveLineHeight,
} from "@/lib/diff-typography";
import { useReviewContext } from "@/lib/review-context";
import { useDiffSettings } from "@/lib/use-diff-settings";
import { toSingleSideSelection, useTextSelection } from "@/lib/use-text-selection";
import { LineHighlightOverlay } from "./hunk-highlight-overlay";
import { TextSelectionPopup } from "./text-selection-popup";
import { useThreadHover } from "./use-thread-hover";

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

/**
 * Builds CSS for annotation rows on change (addition/deletion) lines so the
 * comment row mirrors the styling of the diff line above: two-tone background
 * (number column darker, content lighter) plus the same indicator bar Pierre
 * draws on `[data-column-number]::before` when `indicators="bars"`.
 */
/**
 * Pierre 1.1.20 sets `isolation: isolate` on its `pre`, which flattens the whole
 * diff into one paint unit — the light-DOM key-change highlight boxes (z-2/z-3
 * siblings of the host) would then paint over comment annotation rows, which
 * Pierre pins at z-index 2. Release the isolation (our diff container is itself
 * `isolate`, so nothing leaks past it) and lift annotation rows above both box
 * layers so comments always render on top of line highlights. The selection
 * popup sits at z-50 and stays above everything.
 */
export const ANNOTATION_STACKING_CSS = `
	pre { isolation: auto; }
	[data-line-annotation] { z-index: 4; }
`;

export function buildChangeAnnotationCSS(additionSlots: string[], deletionSlots: string[]): string {
	function buildSide(slots: string[], side: "addition" | "deletion"): string {
		if (slots.length === 0) return "";

		// `:not([data-selected-line])` lets Pierre's hover/selection blue take over,
		// since our :has() selector has the same specificity as Pierre's selection rules.
		// `[data-background]` mirrors Pierre's own gating: when the user disables the
		// Backgrounds setting, Pierre removes that attribute and stops tinting change
		// lines, so we must do the same for the annotation row.
		const rowSel = slots
			.map(
				(slot) =>
					`[data-background] [data-line-annotation]:has(slot[name="${slot}"]):not([data-selected-line])`,
			)
			.join(", ");
		const contentSel = slots
			.map(
				(slot) =>
					`[data-background] [data-line-annotation]:has(slot[name="${slot}"]):not([data-selected-line]) [data-annotation-content]`,
			)
			.join(", ");
		const barSel = slots
			.map(
				(slot) =>
					`[data-indicators="bars"] [data-line-annotation]:has(slot[name="${slot}"]):not([data-selected-line])::after`,
			)
			.join(", ");

		// Match Pierre exactly: addition bar is solid, deletion bar is a striped gradient.
		const barFill =
			side === "addition"
				? "background-color: var(--diffs-addition-base);"
				: `background-image: linear-gradient(0deg, var(--diffs-bg-deletion) 50%, var(--diffs-deletion-base) 50%);
				   background-repeat: repeat;
				   background-size: 2px 2px;`;

		return `
			${rowSel} {
				background-color: var(--diffs-bg-${side}-number);
			}
			${contentSel} {
				background-color: var(--diffs-bg-${side});
				/* 1px column separator, positioned just outside the left edge so it
				   aligns with Pierre's [data-column-number] border-right above. */
				box-shadow: -1px 0 0 0 var(--diffs-bg);
			}
			${barSel} {
				content: '';
				display: block;
				position: absolute;
				top: 0;
				left: 0;
				width: 4px;
				height: 100%;
				pointer-events: none;
				z-index: 4;
				${barFill}
			}
		`;
	}

	return [buildSide(additionSlots, "addition"), buildSide(deletionSlots, "deletion")]
		.filter(Boolean)
		.join("\n");
}

type PierreDiffViewerProps = {
	filePath?: string;
	selectedLines?: SelectedLineRange | null;
	expandUnchanged?: boolean;
	/**
	 * Hunks GitHub review comments may anchor to, when they differ from the
	 * rendered diff (full-file previews render synthetic context hunks that
	 * GitHub would reject as anchors). Defaults to the rendered diff's hunks.
	 */
	anchorHunks?: Hunk[];
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

/** Line numbers the user force-shown while minimized, tracked per diff side. */
type ForceShownLines = Record<DiffSide, ReadonlySet<number>>;

const NO_FORCE_SHOWN_LINES: ForceShownLines = {
	[DIFF_SIDE.ADDITIONS]: new Set(),
	[DIFF_SIDE.DELETIONS]: new Set(),
};

/**
 * A row is collapsed when inline annotations are minimized and the user hasn't
 * force-shown it (and it isn't hosting a comment composer). Collapsed rows
 * render as a zero-height floating chip instead of the full thread cards.
 */
function isAnnotationRowCollapsed(
	annotation: CommentAnnotation,
	hasDraft: boolean,
	inlineCommentsMinimized: boolean,
	forceShownLines: ForceShownLines,
): boolean {
	const threads = annotation.metadata ?? [];
	if (!inlineCommentsMinimized || threads.length === 0) return false;
	if (hasDraft) return false;
	return !forceShownLines[annotation.side].has(annotation.lineNumber);
}

export function PierreDiffViewer({
	patch,
	fileDiff,
	filePath,
	selectedLines: selectedLinesProp,
	expandUnchanged = false,
	anchorHunks,
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
	const {
		viewMode,
		diffIndicators,
		lineDiffType,
		backgrounds,
		wrap,
		lineNumbers,
		darkSyntaxTheme,
		lightSyntaxTheme,
		diffFontFamily,
		diffFontSize,
		diffLineHeight,
		diffLigatures,
		inlineCommentsMinimized,
	} = useDiffSettings();

	// Defer settings so UI controls update instantly while the expensive diff
	// re-renders at lower priority.
	const deferredViewMode = useDeferredValue(viewMode);
	const deferredIndicators = useDeferredValue(diffIndicators);
	const deferredLineDiffType = useDeferredValue(lineDiffType);
	const deferredBackgrounds = useDeferredValue(backgrounds);
	const deferredWrap = useDeferredValue(wrap);
	const deferredLineNumbers = useDeferredValue(lineNumbers);
	const deferredDarkSyntaxTheme = useDeferredValue(darkSyntaxTheme);
	const deferredLightSyntaxTheme = useDeferredValue(lightSyntaxTheme);
	const deferredFontFamily = useDeferredValue(diffFontFamily);
	const deferredFontSize = useDeferredValue(diffFontSize);
	const deferredLineHeight = useDeferredValue(diffLineHeight);
	const deferredLigatures = useDeferredValue(diffLigatures);
	const deferredExpandUnchanged = useDeferredValue(expandUnchanged);
	const diffHunks = useMemo(
		() => (fileDiff ? fileDiff.hunks : getSingularPatch(patch).hunks),
		[fileDiff, patch],
	);
	// GitHub can only anchor review comments on real patch hunks; synthetic
	// full-file preview hunks render fine but must not admit anchors GitHub
	// would reject on submission.
	const eligibilityHunks = anchorHunks ?? diffHunks;

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
	// In-progress comment composers, one per anchor row — several can be open at
	// once. Both the open anchors and their typed text live in the run-level
	// draft store (keyed by file path) so they survive this viewer unmounting
	// when Virtuoso scrolls its row beyond the overscan window. The bodies map
	// is held outside React state so typing never rebuilds the annotation list.
	const { drafts, setDrafts, draftBodies } = useFileCommentDrafts(filePath);
	const { selectionInfo, clearSelection } = useTextSelection(diffContainerRef);

	// Rows the user expanded while inline comments are minimized ('i' toggle).
	const [forceShownLines, setForceShownLines] = useState<ForceShownLines>(NO_FORCE_SHOWN_LINES);

	// Clear per-line overrides when the global toggle is turned off
	useEffect(() => {
		if (!inlineCommentsMinimized) {
			setForceShownLines(NO_FORCE_SHOWN_LINES);
		}
	}, [inlineCommentsMinimized]);

	const toggleLineVisibility = useCallback((side: DiffSide, lineNumber: number) => {
		setForceShownLines((prev) => {
			const next = new Set(prev[side]);
			if (next.has(lineNumber)) {
				next.delete(lineNumber);
			} else {
				next.add(lineNumber);
			}
			return { ...prev, [side]: next };
		});
	}, []);

	// Hovering a thread highlights its anchored lines. The hook also clears the
	// synthetic selection if a mutation removes the hovered thread before mouseleave.
	const {
		enter: handleThreadMouseEnter,
		hoverLines,
		isHovering,
		leave: handleThreadMouseLeave,
	} = useThreadHover(fileThreads);

	const lineAnnotations = useMemo(
		() => buildCommentAnnotations(fileThreads, drafts),
		[fileThreads, drafts],
	);

	// Tint comment annotation rows on change lines so each comment visually
	// attaches to the diff line it's reviewing. Collapsed rows are zero-height chips,
	// so decorating them would paint a stray tinted strip — exclude them.
	const annotationRowUnsafeCSS = useMemo(() => {
		const additionSlots: string[] = [];
		const deletionSlots: string[] = [];

		for (const annotation of lineAnnotations) {
			const hasDraft = findDraftAt(drafts, annotation.side, annotation.lineNumber) !== undefined;
			if (isAnnotationRowCollapsed(annotation, hasDraft, inlineCommentsMinimized, forceShownLines))
				continue;
			if (!isChangeLine(diffHunks, annotation.lineNumber, annotation.side)) continue;
			const slotName = getLineAnnotationName(annotation);
			if (annotation.side === DIFF_SIDE.ADDITIONS) {
				additionSlots.push(slotName);
			} else {
				deletionSlots.push(slotName);
			}
		}

		return `${ANNOTATION_STACKING_CSS}${buildChangeAnnotationCSS(additionSlots, deletionSlots)}`;
	}, [lineAnnotations, diffHunks, drafts, inlineCommentsMinimized, forceShownLines]);

	// Open a composer at an anchor. A row holds at most one composer, so re-opening the
	// same (side, endLine) adopts the new range's startLine rather than duplicating it.
	const openDraft = useCallback(
		(anchor: CommentDraft) => {
			setDrafts((prev) => upsertDraft(prev, anchor));
		},
		[setDrafts],
	);

	const closeDraft = useCallback(
		(draft: CommentDraft) => {
			clearDraftBody(draftBodies, draft.side, draft.endLine);
			setDrafts((prev) => prev.filter((d) => !isSameAnchor(d, draft.side, draft.endLine)));
		},
		[draftBodies, setDrafts],
	);

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
		[filePath, createLocalThread, createGitHubComment, closeDraft, setDrafts],
	);

	const renderAnnotation = useCallback(
		(annotation: CommentAnnotation): ReactNode => {
			const threads = annotation.metadata ?? [];
			const draft = findDraftAt(drafts, annotation.side, annotation.lineNumber);
			if (threads.length === 0 && !draft) return null;
			const toggleVisibility = () => toggleLineVisibility(annotation.side, annotation.lineNumber);

			// Minimized rows collapse every thread on the line into a single merged
			// indicator chip. An open comment composer always forces the row open.
			if (
				isAnnotationRowCollapsed(
					annotation,
					draft !== undefined,
					inlineCommentsMinimized,
					forceShownLines,
				)
			) {
				return (
					<div className="relative z-20 h-0 font-sans">
						<div className="absolute right-1.5 bottom-0">
							<MinimizedAnnotationIndicator threads={threads} onClick={toggleVisibility} />
						</div>
					</div>
				);
			}

			const controls =
				draft === undefined
					? null
					: resolveCommentControls(
							{ local, startReview },
							{
								canWriteToGitHub: comments.canWriteToGitHub,
								hasPendingReview: comments.hasPendingReview,
								isGitHubAnchor: isGitHubReviewAnchor(eligibilityHunks, draft),
							},
						);
			return (
				<div className="relative z-20 font-sans">
					{inlineCommentsMinimized && threads.length > 0 && (
						<div className="relative h-0">
							<div className="absolute right-1.5 bottom-0">
								<MinimizedAnnotationIndicator
									threads={threads}
									onClick={toggleVisibility}
									isExpanded
								/>
							</div>
						</div>
					)}
					<div
						className="space-y-2 px-3 py-2"
						style={{ maxWidth: "min(48rem, 90cqw)", whiteSpace: "normal" }}
					>
						{threads.map((thread) => (
							// biome-ignore lint/a11y/noStaticElementInteractions: hover only highlights the anchored lines, it's not an interactive control
							<div
								key={thread.id}
								onMouseEnter={() => handleThreadMouseEnter(thread)}
								onMouseLeave={() => handleThreadMouseLeave(thread.id)}
							>
								<ReviewThreadView
									model={{
										thread,
										githubAnchorEligible: isGitHubReviewAnchor(eligibilityHunks, thread),
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
								allowsSuggestedChanges={canSuggestChanges(draft.side)}
								placeholder="Leave a comment…"
								error={draft.error}
								initialBody={readDraftBody(draftBodies, draft.side, draft.endLine)}
								onBodyChange={(body) =>
									writeDraftBody(draftBodies, draft.side, draft.endLine, body)
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
				</div>
			);
		},
		[
			drafts,
			draftBodies,
			comments.canWriteToGitHub,
			comments.hasPendingReview,
			eligibilityHunks,
			local,
			startReview,
			setLocal,
			setStartReview,
			handleCreateComment,
			closeDraft,
			handleThreadMouseEnter,
			handleThreadMouseLeave,
			inlineCommentsMinimized,
			forceShownLines,
			toggleLineVisibility,
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
			if (isHovering() || !range) return;
			// A thread anchors to one side, so cross-side gutter drags are ignored.
			const selection = toSingleSideSelection(range);
			if (!selection) return;
			openDraft(selection);
		},
		[openDraft, isHovering],
	);

	const options = useMemo(
		() => ({
			// Light and dark each carry the user's separately persisted theme; Pierre
			// renders the one selected by themeType.
			theme: {
				dark: deferredDarkSyntaxTheme,
				light: deferredLightSyntaxTheme,
			},
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
			unsafeCSS: annotationRowUnsafeCSS,
		}),
		[
			appTheme,
			deferredDarkSyntaxTheme,
			deferredLightSyntaxTheme,
			deferredViewMode,
			deferredIndicators,
			deferredLineDiffType,
			deferredBackgrounds,
			deferredWrap,
			deferredLineNumbers,
			deferredExpandUnchanged,
			handleLineSelected,
			annotationRowUnsafeCSS,
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

	// Inherited CSS custom properties Pierre reads; they cascade into its shadow
	// root, applying typography in a single reactive place. Typed as an intersection
	// so the `--diffs-*` keys are allowed yet the value stays assignable to `style`.
	const typographyStyle: CSSProperties & Record<`--diffs-${string}`, string> = {
		"--diffs-font-family": resolveFontFamily(deferredFontFamily),
		"--diffs-font-size": resolveFontSize(deferredFontSize),
		"--diffs-line-height": resolveLineHeight(deferredLineHeight),
		"--diffs-font-features": resolveFontFeatures(deferredLigatures),
	};

	if (fileDiff) {
		return (
			<div
				className="@container/diff relative isolate overflow-hidden rounded-b-lg border-x border-b border-border"
				ref={diffContainerRef}
				style={typographyStyle}
			>
				<FileDiff<LineAnchoredReviewThread[]> fileDiff={fileDiff} {...sharedProps} />
				{overlay}
				{textSelectionPopup}
			</div>
		);
	}

	return (
		<div
			className="@container/diff relative isolate overflow-hidden rounded-b-lg border-x border-b border-border"
			ref={diffContainerRef}
			style={typographyStyle}
		>
			<PatchDiff<LineAnchoredReviewThread[]> patch={patch} {...sharedProps} />
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
 * Returns true when the given line is an addition (RIGHT side) or deletion (LEFT side),
 * not a context line. Used to decide whether to tint the inline comment annotation row.
 */
export function isChangeLine(hunks: Hunk[], line: number, side: DiffSide): boolean {
	const hunk = findContainingHunk(hunks, line, side);
	if (!hunk) return false;

	const isAdditionsSide = side === DIFF_SIDE.ADDITIONS;
	let currentLine = isAdditionsSide ? hunk.additionStart : hunk.deletionStart;

	for (const content of hunk.hunkContent) {
		// This Pierre version exposes block sizes as line counts, not line arrays.
		const blockSize =
			content.type === "context"
				? content.lines
				: isAdditionsSide
					? content.additions
					: content.deletions;
		if (blockSize === 0) continue;
		if (line < currentLine + blockSize) return content.type === "change";
		currentLine += blockSize;
	}
	return false;
}

/** GitHub line comments must start and end inside the same hunk in the PR diff. */
export function isGitHubReviewAnchor(hunks: Hunk[], anchor: CommentDraft): boolean {
	const startHunk = findContainingHunk(hunks, anchor.startLine, anchor.side);
	if (!startHunk) return false;
	return findContainingHunk(hunks, anchor.endLine, anchor.side) === startHunk;
}

/** GitHub suggestions can only target the head/right side of a diff. */
function canSuggestChanges(side: DiffSide): boolean {
	return side === DIFF_SIDE.ADDITIONS;
}

/**
 * Re-export {@link getSingularPatch} so chapter parents can pre-compute hunks
 * without taking a direct dependency on `@pierre/diffs`.
 */
export { getSingularPatch };
