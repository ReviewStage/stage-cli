import type { Chapter, LineRef } from "@stagereview/types/chapters";
import type { FileContentsMap } from "@stagereview/types/diff";
import { Link, Navigate } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { type ListRange, Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { ContinuousChapterPanel } from "@/components/chapter/continuous-chapter-panel";
import {
	alignElementTopToContentTop,
	getContentTop,
	scrollToRenderedLine,
} from "@/components/chapter/continuous-scroll-into-view";
import type { ChapterOverlayProps, CollapseState } from "@/components/files";
import {
	FileDiffSection,
	findScrollParent,
	resolveFileContent,
} from "@/components/files/file-diff-list";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useChapterContext } from "@/lib/chapter-context";
import { useChapterViewState } from "@/lib/chapter-view-state-context";
import { useProvideCollapseActions } from "@/lib/collapse-actions-context";
import { FILE_STATUS } from "@/lib/diff-types";
import { filterFilesForChapter } from "@/lib/filter-files-for-chapter";
import { formatChapterAsMarkdown } from "@/lib/format-chapter-markdown";
import { KEYBOARD_SHORTCUTS } from "@/lib/keyboard-shortcuts";
import { groupAnnotatedLineRefsByFile, groupLineRefsByFile } from "@/lib/line-refs-by-file";
import type { FileDiffEntry } from "@/lib/parse-diff";
import { sortLineRefsByChapterOrder } from "@/lib/sort-line-refs";
import {
	NAVIGATION_DIRECTION,
	type NavigationDirection,
	useChapterNavigationKeys,
} from "@/lib/use-chapter-navigation-keys";
import { PANEL_POSITION, type PanelPosition, useChapterSettings } from "@/lib/use-chapter-settings";
import { useChapters } from "@/lib/use-chapters";
import { useDiffPatch } from "@/lib/use-diff-patch";
import { useDiffSettings } from "@/lib/use-diff-settings";
import { useFileCollapseState } from "@/lib/use-file-collapse-state";
import { type UseViewStateResult, useViewState } from "@/lib/use-view-state";
import { cn } from "@/lib/utils";

interface ContinuousChaptersPageProps {
	runId: string;
	/** Chapter to scroll to on mount (from a normalized `/chapters/N` deep link). */
	initialChapterNumber?: number;
}

/**
 * Continuous chapter review: a single virtualized stream of every chapter's
 * file diffs with a sticky per-chapter narrative panel. Chapters come from
 * ChapterContext, diffs from the run's patch + file contents, and viewed
 * state from the local view-state API. Unlike the paged view (which scrolls
 * the window), this page renders inside the pull-request layout's contained
 * scroll area, so all scroll work targets that container.
 */
export function ContinuousChaptersPage({
	runId,
	initialChapterNumber,
}: ContinuousChaptersPageProps) {
	const { chapters } = useChapterContext();
	const { isLoading: chaptersLoading, error: chaptersError } = useChapters(runId);
	const { data: diffData, isLoading: patchLoading, error: patchError } = useDiffPatch(runId);

	const isLoading = chaptersLoading || patchLoading;
	const error = chaptersError ?? patchError;

	if (error) return <ErrorState runId={runId} error={error} />;
	if (isLoading) return <LoadingState />;
	if (diffData === undefined) {
		return <ErrorState runId={runId} error={new Error("Diff patch unavailable")} />;
	}
	if (chapters.length === 0) {
		return <Navigate to="/runs/$runId" params={{ runId }} replace />;
	}

	return (
		<ContinuousChaptersContent
			key={runId}
			initialChapterNumber={initialChapterNumber}
			patch={diffData.patch}
			fileContents={diffData.fileContents}
		/>
	);
}

interface ChapterDiffModel {
	chapter: Chapter;
	entries: FileDiffEntry[];
	filePaths: string[];
}

interface FocusedKeyChangeState {
	keyChangeId: string;
	scrollTarget: LineRef | null;
}

/**
 * Props shared by every chapter section. Bundled so the memoized sections can
 * compare one stable object instead of two dozen loose props.
 */
interface SectionSharedProps {
	runId: string;
	totalChapters: number;
	position: PanelPosition;
	scrollContainer: HTMLElement;
	/** Raw per-file contents for image diffs and full-file rename previews. */
	fileContents: FileContentsMap;
	view: UseViewStateResult;
	focusedKeyChangeId: string | null;
	focusedKeyChangeChapterId: string | null;
	focusedLineRefs: LineRef[] | null;
	focusedLineRefsByFile: Map<string, LineRef[]> | null;
	focusedScrollTarget: LineRef | null;
	onFocusKeyChange: (keyChangeId: string | null, scrollTarget?: LineRef | null) => void;
	onToggleChapterViewed: (chapter: Chapter) => void;
	onToggleKeyChangeChecked: (keyChangeId: string) => void;
	onToggleFileViewed: (model: ChapterDiffModel, filePath: string) => void;
	onActivate: (chapterNumber: number) => void;
}

interface ContinuousChaptersContentProps {
	initialChapterNumber?: number;
	patch: string;
	fileContents: FileContentsMap;
}

function ContinuousChaptersContent({
	initialChapterNumber,
	patch,
	fileContents,
}: ContinuousChaptersContentProps) {
	const { runId, chapters: allChapters } = useChapterContext();
	const view = useViewState(runId);
	const { panelPosition } = useChapterSettings();

	// All chapter diff models are computed before the virtualized sections
	// mount. The CLI's patch and file contents arrive in a single fetch and
	// never change for a run, so a plain memo suffices.
	const models = useMemo<ChapterDiffModel[]>(
		() =>
			allChapters.map((chapter) => {
				const entries = filterFilesForChapter(patch, chapter.hunkRefs, fileContents);
				return { chapter, entries, filePaths: entries.map((e) => e.file.path) };
			}),
		[allChapters, patch, fileContents],
	);

	// Clamp deep-linked numbers so an out-of-range link can't publish an
	// invalid active chapter (switching to paged mode would 404 on it).
	const [activeChapterNumber, setActiveChapterNumber] = useState(() =>
		Math.min(Math.max(initialChapterNumber ?? 1, 1), Math.max(allChapters.length, 1)),
	);
	const activeChapter = allChapters[activeChapterNumber - 1];

	// Report the active chapter so the settings form can preserve it when
	// switching back to paged mode.
	const chapterViewState = useChapterViewState();
	const setActiveContinuousChapterNumber = chapterViewState?.setActiveContinuousChapterNumber;
	useEffect(() => {
		setActiveContinuousChapterNumber?.(activeChapterNumber);
	}, [setActiveContinuousChapterNumber, activeChapterNumber]);

	// The pull-request layout owns the contained scroll area this page renders
	// into; resolve it from the DOM since the layout doesn't expose it.
	const listRootRef = useRef<HTMLDivElement>(null);
	const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(null);
	useLayoutEffect(() => {
		setScrollContainer(findScrollParent(listRootRef.current));
	}, []);

	const virtuosoRef = useRef<VirtuosoHandle>(null);
	const suppressTrackingRef = useRef(false);
	const suppressIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pendingMeasureFrameRef = useRef<number | null>(null);

	// Programmatic scrolls (panel clicks, hotkeys, deep links) glide through
	// intermediate chapters; suppress scroll-driven tracking until the scroll
	// settles so the active chapter doesn't flicker along the way.
	const restartSuppressionIdleTimer = useCallback(() => {
		if (suppressIdleTimerRef.current !== null) clearTimeout(suppressIdleTimerRef.current);
		suppressIdleTimerRef.current = setTimeout(() => {
			suppressIdleTimerRef.current = null;
			suppressTrackingRef.current = false;
		}, 150);
	}, []);

	const suppressTracking = useCallback(() => {
		suppressTrackingRef.current = true;
		restartSuppressionIdleTimer();
	}, [restartSuppressionIdleTimer]);

	const totalChapters = models.length;

	const scrollToChapter = useCallback(
		(chapterNumber: number): boolean => {
			const index = chapterNumber - 1;
			if (index < 0 || index >= totalChapters) return false;
			if (!virtuosoRef.current) return false;
			suppressTracking();
			virtuosoRef.current.scrollToIndex({
				index,
				align: "start",
				offset: -getContentTop(listRootRef.current),
				behavior: "auto",
			});
			return true;
		},
		[totalChapters, suppressTracking],
	);

	// Scroll to the deep-linked chapter once the list can perform the scroll
	// (Virtuoso mounts a frame after the scroll container resolves).
	const lastAppliedInitialScrollRef = useRef<number | null>(null);
	const initialScrollRequestRef = useRef(0);
	useLayoutEffect(() => {
		if (initialChapterNumber === undefined) return;
		if (initialChapterNumber < 1 || initialChapterNumber > totalChapters) return;
		if (lastAppliedInitialScrollRef.current === initialChapterNumber) return;

		const requestId = initialScrollRequestRef.current + 1;
		initialScrollRequestRef.current = requestId;
		let frame: number | null = null;

		const applyScroll = () => {
			if (initialScrollRequestRef.current !== requestId) return;
			if (!scrollToChapter(initialChapterNumber)) {
				frame = window.requestAnimationFrame(applyScroll);
				return;
			}
			lastAppliedInitialScrollRef.current = initialChapterNumber;
			setActiveChapterNumber(initialChapterNumber);
		};

		applyScroll();

		return () => {
			initialScrollRequestRef.current += 1;
			if (frame !== null) window.cancelAnimationFrame(frame);
		};
	}, [initialChapterNumber, totalChapters, scrollToChapter]);

	const setActiveChapterFromIndex = useCallback(
		(index: number) => {
			const chapterNumber = index + 1;
			if (chapterNumber >= 1 && chapterNumber <= totalChapters) {
				setActiveChapterNumber(chapterNumber);
			}
		},
		[totalChapters],
	);

	// Track the active chapter with viewport-line measurement: the chapter
	// whose section crosses a line ~1/3 down the visible content wins.
	const measureActiveChapter = useCallback(() => {
		const listRoot = listRootRef.current;
		if (!scrollContainer || !listRoot) return;
		const contentTop = getContentTop(listRoot);
		const lineY =
			scrollContainer.getBoundingClientRect().top +
			contentTop +
			(scrollContainer.clientHeight - contentTop) / 3;
		let activeSection: HTMLElement | null = null;
		for (const section of listRoot.querySelectorAll<HTMLElement>("[data-chapter-number]")) {
			if (section.getBoundingClientRect().top > lineY) break;
			activeSection = section;
		}
		if (!activeSection) return;
		const chapterNumber = Number(activeSection.dataset.chapterNumber);
		setActiveChapterFromIndex(chapterNumber - 1);
	}, [scrollContainer, setActiveChapterFromIndex]);

	const handleRangeChanged = useCallback(
		(range: ListRange) => {
			if (suppressTrackingRef.current) return;
			setActiveChapterFromIndex(range.startIndex);
		},
		[setActiveChapterFromIndex],
	);

	const scheduleMeasure = useCallback(() => {
		if (pendingMeasureFrameRef.current !== null) return;
		pendingMeasureFrameRef.current = requestAnimationFrame(() => {
			pendingMeasureFrameRef.current = null;
			measureActiveChapter();
		});
	}, [measureActiveChapter]);

	useEffect(() => {
		if (!scrollContainer) return;
		const handleScroll = () => {
			if (suppressTrackingRef.current) {
				restartSuppressionIdleTimer();
				return;
			}
			scheduleMeasure();
		};
		const resumeTracking = () => {
			suppressTrackingRef.current = false;
		};
		scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
		scrollContainer.addEventListener("wheel", resumeTracking, { passive: true });
		scrollContainer.addEventListener("touchmove", resumeTracking, { passive: true });
		return () => {
			scrollContainer.removeEventListener("scroll", handleScroll);
			scrollContainer.removeEventListener("wheel", resumeTracking);
			scrollContainer.removeEventListener("touchmove", resumeTracking);
			if (pendingMeasureFrameRef.current !== null) {
				cancelAnimationFrame(pendingMeasureFrameRef.current);
				pendingMeasureFrameRef.current = null;
			}
			if (suppressIdleTimerRef.current !== null) {
				clearTimeout(suppressIdleTimerRef.current);
				suppressIdleTimerRef.current = null;
			}
		};
	}, [scrollContainer, scheduleMeasure, restartSuppressionIdleTimer]);

	const navigateToChapter = useCallback(
		(chapterNumber: number) => {
			setActiveChapterNumber(chapterNumber);
			scrollToChapter(chapterNumber);
		},
		[scrollToChapter],
	);

	// Chapter navigation keys step the stream to the previous/next chapter
	// (parity with the paged view's shortcuts).
	const handleChapterNavigate = useCallback(
		(direction: NavigationDirection) => {
			const target =
				direction === NAVIGATION_DIRECTION.NEXT ? activeChapterNumber + 1 : activeChapterNumber - 1;
			if (target < 1 || target > totalChapters) return;
			navigateToChapter(target);
		},
		[activeChapterNumber, totalChapters, navigateToChapter],
	);
	useChapterNavigationKeys(handleChapterNavigate);

	// After a chapter is marked viewed, advance the stream to the next chapter —
	// unless every chapter is now viewed, in which case stay on the continuous
	// view. Advancing only applies when the
	// completed chapter is the one currently active on screen.
	const advanceAfterChapterComplete = useCallback(
		(completed: Chapter) => {
			const willBeAllViewed = allChapters.every(
				(ch) => ch.externalId === completed.externalId || view.chapterIdSet.has(ch.externalId),
			);
			if (willBeAllViewed) return;
			const completedNumber = allChapters.indexOf(completed) + 1;
			if (completedNumber !== activeChapterNumber) return;
			if (completedNumber < allChapters.length) navigateToChapter(completedNumber + 1);
		},
		[allChapters, view.chapterIdSet, activeChapterNumber, navigateToChapter],
	);

	const handleToggleChapterViewed = useCallback(
		(chapter: Chapter) => {
			if (view.chapterIdSet.has(chapter.externalId)) {
				view.unmarkChapterViewed(chapter.externalId);
				// A chapter can read as viewed purely because all of its files are
				// viewed, so unmarking must also clear those file views (mirrors the
				// paged detail toggle) or the unmark is a no-op.
				for (const path of new Set(chapter.hunkRefs.map((h) => h.filePath))) {
					if (view.isFileViewed(path)) view.unmarkFileViewed(path);
				}
				return;
			}
			view.markChapterViewed(chapter.externalId);
			advanceAfterChapterComplete(chapter);
		},
		[view, advanceAfterChapterComplete],
	);

	useHotkeys(
		KEYBOARD_SHORTCUTS.MARK_CHAPTER_AS_VIEWED.hotkey,
		() => {
			if (activeChapter) handleToggleChapterViewed(activeChapter);
		},
		{ preventDefault: true, enableOnFormTags: false },
		[handleToggleChapterViewed, activeChapter],
	);

	// One binding for the whole stream — FileDiffList, the usual page-level
	// registrar of this shortcut, is not mounted in continuous mode.
	const { toggleInlineCommentsMinimized } = useDiffSettings();
	useHotkeys(KEYBOARD_SHORTCUTS.TOGGLE_INLINE_COMMENTS.hotkey, toggleInlineCommentsMinimized, {
		preventDefault: true,
		enableOnFormTags: false,
	});

	const handleToggleFileViewed = useCallback(
		(model: ChapterDiffModel, filePath: string) => {
			if (view.filePathSet.has(filePath)) {
				view.unmarkFileViewed(filePath);
				return;
			}
			view.markFileViewed(filePath);
			// Auto-complete the chapter once its last unviewed file is marked, so
			// finishing a chapter's files also marks the chapter viewed and advances.
			const willCompleteChapter =
				!view.chapterIdSet.has(model.chapter.externalId) &&
				model.filePaths.every((path) => path === filePath || view.filePathSet.has(path));
			if (willCompleteChapter) {
				view.markChapterViewed(model.chapter.externalId);
				advanceAfterChapterComplete(model.chapter);
			}
		},
		[view, advanceAfterChapterComplete],
	);

	const handleToggleKeyChangeChecked = useCallback(
		(keyChangeId: string) => {
			if (view.keyChangeIdSet.has(keyChangeId)) view.unmarkKeyChangeChecked(keyChangeId);
			else view.markKeyChangeChecked(keyChangeId);
		},
		[view],
	);

	// Focus is page-level and NOT reset when the active chapter changes — the
	// active chapter changes on mere scrolling and every chapter's diffs stay
	// mounted, so focus survives until the user toggles it off.
	const [focus, setFocus] = useState<FocusedKeyChangeState | null>(null);
	const handleFocusKeyChange = useCallback(
		(keyChangeId: string | null, scrollTarget?: LineRef | null) => {
			setFocus(keyChangeId ? { keyChangeId, scrollTarget: scrollTarget ?? null } : null);
		},
		[],
	);

	// The focused key change is owned by whichever chapter contains it — in
	// continuous mode that may not be the active chapter, and it's the owning
	// chapter's diffs that the focus overlay and scroll must target.
	const focusOwner = useMemo(() => {
		if (!focus) return null;
		for (const model of models) {
			const keyChange = model.chapter.keyChanges.find((k) => k.externalId === focus.keyChangeId);
			if (keyChange) return { chapter: model.chapter, keyChange };
		}
		return null;
	}, [models, focus]);

	const focusedLineRefs = useMemo(() => {
		if (!focusOwner || focusOwner.keyChange.lineRefs.length === 0) return null;
		return sortLineRefsByChapterOrder(focusOwner.keyChange.lineRefs, focusOwner.chapter.hunkRefs);
	}, [focusOwner]);

	const focusedLineRefsByFile = useMemo(
		() => groupLineRefsByFile(focusedLineRefs),
		[focusedLineRefs],
	);

	const shared = useMemo<SectionSharedProps | null>(() => {
		if (!scrollContainer) return null;
		return {
			runId,
			totalChapters,
			position: panelPosition,
			scrollContainer,
			fileContents,
			view,
			focusedKeyChangeId: focus?.keyChangeId ?? null,
			focusedKeyChangeChapterId: focusOwner?.chapter.id ?? null,
			focusedLineRefs,
			focusedLineRefsByFile,
			focusedScrollTarget: focus?.scrollTarget ?? null,
			onFocusKeyChange: handleFocusKeyChange,
			onToggleChapterViewed: handleToggleChapterViewed,
			onToggleKeyChangeChecked: handleToggleKeyChangeChecked,
			onToggleFileViewed: handleToggleFileViewed,
			onActivate: setActiveChapterNumber,
		};
	}, [
		runId,
		totalChapters,
		panelPosition,
		scrollContainer,
		fileContents,
		view,
		focus,
		focusOwner,
		focusedLineRefs,
		focusedLineRefsByFile,
		handleFocusKeyChange,
		handleToggleChapterViewed,
		handleToggleKeyChangeChecked,
		handleToggleFileViewed,
	]);

	const isTop = panelPosition === PANEL_POSITION.TOP;

	return (
		<div className="flex flex-col">
			{/* Top divider the sticky panels pin under in the side layouts. */}
			{!isTop && <div className="sticky top-[var(--content-top)] z-10 border-border border-t" />}
			<div ref={listRootRef} className="pb-8">
				{shared && (
					<Virtuoso
						ref={virtuosoRef}
						customScrollParent={shared.scrollContainer}
						data={models}
						computeItemKey={(_, model) => model.chapter.id}
						defaultItemHeight={900}
						increaseViewportBy={{ top: 2500, bottom: 8000 }}
						minOverscanItemCount={{ top: 1, bottom: 3 }}
						overscan={{ main: 1200, reverse: 800 }}
						totalListHeightChanged={() => {
							if (suppressTrackingRef.current) return;
							scheduleMeasure();
						}}
						rangeChanged={handleRangeChanged}
						itemContent={(index, model) => (
							<ContinuousChapterSection
								model={model}
								chapterNumber={index + 1}
								isActive={activeChapterNumber === index + 1}
								shared={shared}
							/>
						)}
					/>
				)}
			</div>
		</div>
	);
}

interface ContinuousChapterSectionProps {
	model: ChapterDiffModel;
	chapterNumber: number;
	isActive: boolean;
	shared: SectionSharedProps;
}

const ContinuousChapterSection = memo(function ContinuousChapterSection({
	model,
	chapterNumber,
	isActive,
	shared,
}: ContinuousChapterSectionProps) {
	const { chapter, entries, filePaths } = model;
	const { view, scrollContainer } = shared;
	const [focusedFilePath, setFocusedFilePath] = useState<string>();
	const pendingDisconnectsRef = useRef<Set<() => void>>(new Set());
	const scrollRequestRef = useRef(0);

	useEffect(() => {
		const pending = pendingDisconnectsRef.current;
		return () => {
			scrollRequestRef.current += 1;
			for (const disconnect of pending) disconnect();
			pending.clear();
		};
	}, []);

	const files = useMemo(() => entries.map((e) => e.file), [entries]);
	const chapterFilePathSet = useMemo(() => new Set(filePaths), [filePaths]);

	// Chapter-scoped default collapse policy: deleted and already-viewed files
	// start collapsed. Independent per chapter so collapsing a file in one
	// chapter doesn't affect the same file in another chapter.
	const defaultCollapsedIds = useMemo(() => {
		const ids = new Set<string>();
		for (const file of files) {
			if (file.status === FILE_STATUS.DELETED) ids.add(file.path);
		}
		for (const path of view.filePathSet) {
			if (chapterFilePathSet.has(path)) ids.add(path);
		}
		return ids;
	}, [files, chapterFilePathSet, view.filePathSet]);

	// Identity parts passed separately (AGENTS.md forbids concatenated keys).
	const collapseState = useFileCollapseState(defaultCollapsedIds, filePaths, [
		shared.runId,
		chapter.id,
	]);

	const scrollToFile = useCallback(
		(filePath: string) => {
			const element = findFileContainer(chapter.id, filePath);
			if (!element) return;
			alignElementTopToContentTop(scrollContainer, element);
		},
		[chapter.id, scrollContainer],
	);

	const cancelPendingLineScroll = useCallback(() => {
		scrollRequestRef.current += 1;
		const pending = pendingDisconnectsRef.current;
		for (const disconnect of pending) disconnect();
		pending.clear();
	}, []);

	const scrollToLine = useCallback(
		(target: LineRef) => {
			const container = findFileContainer(chapter.id, target.filePath);
			if (!container) return;

			cancelPendingLineScroll();

			if (collapseState.collapsedFiles.has(target.filePath)) {
				collapseState.toggleFileCollapsed(target.filePath);
			}

			scrollRequestRef.current += 1;
			const requestToken = scrollRequestRef.current;

			scrollToRenderedLine({
				container,
				scrollContainer,
				side: target.side,
				line: target.startLine,
				isLatestRequest: () => scrollRequestRef.current === requestToken,
				pendingDisconnects: pendingDisconnectsRef.current,
			});
		},
		[cancelPendingLineScroll, chapter.id, collapseState, scrollContainer],
	);

	// Focus is owned by the chapter containing the focused key change, so a
	// click in any chapter's panel highlights and scrolls that chapter's own
	// diffs — even when it isn't the scroll-active chapter.
	const isFocusOwner = shared.focusedKeyChangeChapterId === chapter.id;

	// Per-section focus data: every chapter gets overlay boxes for its own key
	// changes, and per-section grouping prevents focus-highlight bleed when the
	// same file appears in two chapters.
	const allLineRefsByFile = useMemo(
		() => groupAnnotatedLineRefsByFile(chapter.keyChanges),
		[chapter.keyChanges],
	);

	const { focusedKeyChangeId, focusedScrollTarget, focusedLineRefs } = shared;
	const focusedLineRefsRef = useRef(focusedLineRefs);
	focusedLineRefsRef.current = focusedLineRefs;
	// Latest-callback refs keep this a one-shot per focus action: collapse or
	// viewed-state changes rebuild scrollToLine, and re-running the effect for
	// that would scroll back to (and re-expand) the old focused line.
	const scrollToLineRef = useRef(scrollToLine);
	scrollToLineRef.current = scrollToLine;
	const cancelPendingLineScrollRef = useRef(cancelPendingLineScroll);
	cancelPendingLineScrollRef.current = cancelPendingLineScroll;
	useEffect(() => {
		if (focusedScrollTarget && isFocusOwner) {
			scrollToLineRef.current(focusedScrollTarget);
			return;
		}
		if (!focusedKeyChangeId || !isFocusOwner) {
			// Focus cleared or moved to another chapter — invalidate any
			// in-flight scroll so its pending observers don't align a stale
			// line after the highlight disappeared.
			cancelPendingLineScrollRef.current();
			return;
		}
		const target = focusedLineRefsRef.current?.[0];
		if (!target) return;
		scrollToLineRef.current(target);
	}, [focusedKeyChangeId, focusedScrollTarget, isFocusOwner]);

	const handleToggleFileViewed = useCallback(
		(filePath: string) => {
			shared.onActivate(chapterNumber);
			shared.onToggleFileViewed(model, filePath);
		},
		[shared, chapterNumber, model],
	);

	const handleSelectFile = useCallback(
		(filePath: string) => {
			shared.onActivate(chapterNumber);
			setFocusedFilePath(filePath);
			scrollToFile(filePath);
		},
		[shared, chapterNumber, scrollToFile],
	);

	const handleCopyChapter = useCallback(() => {
		void navigator.clipboard.writeText(formatChapterAsMarkdown(chapter, entries));
	}, [chapter, entries]);

	const chapterOverlay = useMemo<ChapterOverlayProps>(
		() => ({
			allLineRefsByFile,
			focusedLineRefsByFile: isFocusOwner ? shared.focusedLineRefsByFile : null,
			focusedKeyChangeId: isFocusOwner ? shared.focusedKeyChangeId : null,
			isKeyChangeChecked: view.isKeyChangeChecked,
			onMarkKeyChangeChecked: view.markKeyChangeChecked,
			onUnmarkKeyChangeChecked: view.unmarkKeyChangeChecked,
			onFocusKeyChange: shared.onFocusKeyChange,
		}),
		[allLineRefsByFile, isFocusOwner, shared, view],
	);

	const panel = (
		<ContinuousChapterPanel
			chapter={chapter}
			files={files}
			chapterNumber={chapterNumber}
			totalChapters={shared.totalChapters}
			isActive={isActive}
			position={shared.position}
			focusedFilePath={focusedFilePath}
			viewedChapterIds={view.chapterIdSet}
			checkedKeyChangeIds={view.keyChangeIdSet}
			viewedFilePathSet={view.filePathSet}
			focusedKeyChangeId={isFocusOwner ? shared.focusedKeyChangeId : null}
			onToggleChapterViewed={shared.onToggleChapterViewed}
			onToggleKeyChangeChecked={shared.onToggleKeyChangeChecked}
			onToggleFileViewed={handleToggleFileViewed}
			onFocusKeyChange={shared.onFocusKeyChange}
			onSelectFile={handleSelectFile}
			onCopyChapter={handleCopyChapter}
		/>
	);

	const diffs =
		entries.length === 0 ? (
			<div className="mt-4 rounded-lg border border-border border-dashed px-4 py-8 text-center text-muted-foreground text-sm">
				No changes in this chapter
			</div>
		) : (
			<div>
				{/* The shared FileDiffSection with an explicit, chapter-scoped container
				    id — FileDiffList's default `file-${path}` ids would collide when the
				    same file appears in multiple chapters of the continuous stream. */}
				{entries.map((entry) => (
					<div
						key={entry.file.path}
						style={{ paddingTop: 16 }}
						data-continuous-chapter-id={chapter.id}
						data-continuous-file-path={entry.file.path}
					>
						<FileDiffSection
							entry={entry}
							content={resolveFileContent(shared.fileContents, entry)}
							containerId={null}
							isViewed={view.filePathSet.has(entry.file.path)}
							isFocused={entry.file.path === focusedFilePath}
							onToggleViewed={handleToggleFileViewed}
							collapseState={collapseState}
							chapterOverlay={chapterOverlay}
						/>
					</div>
				))}
			</div>
		);

	// Register the ACTIVE chapter's collapse state with the toolbar button so
	// expand/collapse all operates on the chapter currently on screen.
	const collapseRegistration = isActive && (
		<ActiveCollapseRegistration collapseState={collapseState} fileCount={filePaths.length} />
	);

	if (shared.position === PANEL_POSITION.TOP) {
		return (
			<section
				data-chapter-number={chapterNumber}
				className={cn("px-1", chapterNumber > 1 && "border-border border-t")}
			>
				{collapseRegistration}
				<div className="pt-6">{panel}</div>
				<div className="min-w-0 pb-6">{diffs}</div>
			</section>
		);
	}

	const isRight = shared.position === PANEL_POSITION.RIGHT;

	return (
		<section
			data-chapter-number={chapterNumber}
			className={cn(
				"flex items-start",
				isRight && "flex-row-reverse",
				chapterNumber > 1 && "border-border border-t",
			)}
		>
			{collapseRegistration}
			{panel}
			<div className="min-w-0 flex-1 px-1 pb-6 lg:px-4">{diffs}</div>
		</section>
	);
});

/**
 * Conditional mount = conditional registration: `useProvideCollapseActions`
 * always registers, so only the active chapter's section mounts this.
 */
function ActiveCollapseRegistration({
	collapseState,
	fileCount,
}: {
	collapseState: CollapseState;
	fileCount: number;
}) {
	useProvideCollapseActions(collapseState, fileCount);
	return null;
}

/**
 * Locate a chapter section's file container via paired data attributes —
 * serializing both identities into one DOM id could collide when a chapter id
 * and file path embed the delimiter (AGENTS.md forbids concatenated keys).
 */
function findFileContainer(chapterId: string, filePath: string): HTMLElement | null {
	return document.querySelector<HTMLElement>(
		`[data-continuous-chapter-id="${CSS.escape(chapterId)}"][data-continuous-file-path="${CSS.escape(filePath)}"]`,
	);
}

function LoadingState() {
	return (
		<div className="flex">
			<div className="w-80 shrink-0 border-border border-r p-4">
				<Skeleton className="mb-4 h-10 w-full" />
				<Skeleton className="h-16 w-full" />
				<Skeleton className="mt-2 h-16 w-full" />
			</div>
			<div className="flex-1 p-6">
				<Skeleton className="mb-6 h-48 w-full" />
				<Skeleton className="h-96 w-full" />
			</div>
		</div>
	);
}

function ErrorState({ runId, error }: { runId: string; error: unknown }) {
	const message = error instanceof Error ? error.message : String(error);
	return (
		<div className="flex flex-col items-center justify-center p-12">
			<h2 className="mb-2 font-semibold text-base">Couldn't load chapters</h2>
			<p className="mb-4 max-w-md text-center text-muted-foreground text-sm">{message}</p>
			<Button variant="outline" size="sm" asChild>
				<Link to="/runs/$runId" params={{ runId }}>
					Back to overview
				</Link>
			</Button>
		</div>
	);
}
