import type { Chapter, LineRef } from "@stagereview/types/chapters";
import type { FileContentsMap } from "@stagereview/types/diff";
import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { ChapterSidePanel } from "@/components/chapter";
import { type ChapterOverlayProps, FileDiffList, SidebarLayout } from "@/components/files";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useChapterContext } from "@/lib/chapter-context";
import { useProvideCollapseActions } from "@/lib/collapse-actions-context";
import { FILE_STATUS } from "@/lib/diff-types";
import { filterFilesForChapter } from "@/lib/filter-files-for-chapter";
import { formatChapterAsMarkdown } from "@/lib/format-chapter-markdown";
import { KEYBOARD_SHORTCUTS } from "@/lib/keyboard-shortcuts";
import { groupAnnotatedLineRefsByFile, groupLineRefsByFile } from "@/lib/line-refs-by-file";
import { sortLineRefsByChapterOrder } from "@/lib/sort-line-refs";
import {
	NAVIGATION_DIRECTION,
	type NavigationDirection,
	useChapterNavigationKeys,
} from "@/lib/use-chapter-navigation-keys";
import { useChapters } from "@/lib/use-chapters";
import { useDiffPatch } from "@/lib/use-diff-patch";
import { useFileCollapseState } from "@/lib/use-file-collapse-state";
import { useFileDiffNavigation } from "@/lib/use-file-diff-navigation";
import { useViewState } from "@/lib/use-view-state";

interface ChapterDetailPageProps {
	runId: string;
	chapterNumber: number | null;
}

export function ChapterDetailPage({ runId, chapterNumber }: ChapterDetailPageProps) {
	const { chapters } = useChapterContext();
	const { isLoading: chaptersLoading, error: chaptersError } = useChapters(runId);
	const { data: diffData, isLoading: patchLoading, error: patchError } = useDiffPatch(runId);

	const chapter =
		chapterNumber === null ? undefined : chapters.find((c) => c.order === chapterNumber);
	const chapterIndex = chapter ? chapters.indexOf(chapter) : -1;

	const isLoading = chaptersLoading || patchLoading;
	const error = chaptersError ?? patchError;

	if (chapterNumber === null) return <NotFoundState runId={runId} />;
	if (error) return <ErrorState runId={runId} error={error} />;
	if (isLoading) return <LoadingState />;
	if (!chapter) return <NotFoundState runId={runId} />;
	if (diffData === undefined) {
		return <ErrorState runId={runId} error={new Error("Diff patch unavailable")} />;
	}

	return (
		<ChapterDetailContent
			chapter={chapter}
			chapterIndex={chapterIndex}
			patch={diffData.patch}
			fileContents={diffData.fileContents}
		/>
	);
}

interface ChapterDetailContentProps {
	chapter: Chapter;
	chapterIndex: number;
	patch: string;
	fileContents: FileContentsMap;
}

function ChapterDetailContent({
	chapter,
	chapterIndex,
	patch,
	fileContents,
}: ChapterDetailContentProps) {
	const { runId, chapters: allChapters } = useChapterContext();
	const view = useViewState(runId);
	const [focusedKeyChangeId, setFocusedKeyChangeId] = useState<string | null>(null);

	// Reset focus when the chapter changes — focus is "currently selected"
	// state local to the page, not something that should persist across nav.
	const lastChapterIdRef = useRef(chapter.id);
	if (lastChapterIdRef.current !== chapter.id) {
		lastChapterIdRef.current = chapter.id;
		if (focusedKeyChangeId !== null) setFocusedKeyChangeId(null);
	}

	const chapterEntries = useMemo(
		() => filterFilesForChapter(patch, chapter.hunkRefs, fileContents),
		[patch, chapter.hunkRefs, fileContents],
	);

	const allLineRefsByFile = useMemo(
		() => groupAnnotatedLineRefsByFile(chapter.keyChanges),
		[chapter.keyChanges],
	);

	const focusedKeyChange = chapter.keyChanges.find((k) => k.externalId === focusedKeyChangeId);
	const focusedLineRefs = useMemo<LineRef[] | null>(() => {
		if (!focusedKeyChange || focusedKeyChange.lineRefs.length === 0) return null;
		return sortLineRefsByChapterOrder(focusedKeyChange.lineRefs, chapter.hunkRefs);
	}, [focusedKeyChange, chapter.hunkRefs]);

	const focusedLineRefsByFile = useMemo(
		() => groupLineRefsByFile(focusedLineRefs),
		[focusedLineRefs],
	);

	const chapterFiles = useMemo(() => chapterEntries.map((e) => e.file), [chapterEntries]);
	const chapterFilePaths = useMemo(() => chapterFiles.map((f) => f.path), [chapterFiles]);
	const chapterFilePathSet = useMemo(() => new Set(chapterFilePaths), [chapterFilePaths]);

	const navigate = useNavigate();

	// After a chapter is marked viewed, advance to the next chapter — or, once
	// every chapter is viewed, return to the run's chapter list. Mirrors the
	// hosted app's mark-complete flow (minus the confetti the CLI omits).
	const advanceAfterChapterComplete = useCallback(() => {
		// markChapterViewed patches the cache on a later tick, so this snapshot
		// still excludes the chapter just marked — treat it as about-to-be-viewed.
		const willBeAllViewed = allChapters.every(
			(ch) => ch.externalId === chapter.externalId || view.chapterIdSet.has(ch.externalId),
		);
		if (willBeAllViewed) {
			void navigate({ to: "/runs/$runId", params: { runId } });
			return;
		}
		const next = allChapters[chapterIndex + 1];
		if (next) {
			void navigate({
				to: "/runs/$runId/chapters/$chapterNumber",
				params: { runId, chapterNumber: String(next.order) },
				// Preserve scroll position when moving between chapters on the detail
				// page (matches the hosted app); resetting would jump to the top.
				resetScroll: false,
			});
		}
	}, [allChapters, chapter.externalId, view.chapterIdSet, chapterIndex, navigate, runId]);

	const handleToggleKeyChangeChecked = useCallback(
		(keyChangeId: string) => {
			if (view.keyChangeIdSet.has(keyChangeId)) view.unmarkKeyChangeChecked(keyChangeId);
			else view.markKeyChangeChecked(keyChangeId);
		},
		[view],
	);

	const handleToggleChapterViewed = useCallback(
		(externalId: string) => {
			if (view.chapterIdSet.has(externalId)) {
				view.unmarkChapterViewed(externalId);
				return;
			}
			view.markChapterViewed(externalId);
			// Advance only when completing the chapter currently on screen.
			if (externalId === chapter.externalId) advanceAfterChapterComplete();
		},
		[view, chapter.externalId, advanceAfterChapterComplete],
	);

	const handleToggleFileViewed = useCallback(
		(filePath: string) => {
			if (view.filePathSet.has(filePath)) {
				view.unmarkFileViewed(filePath);
				return;
			}
			view.markFileViewed(filePath);
			// Auto-complete the chapter once its last unviewed file is marked, so
			// finishing a chapter's files also marks the chapter viewed and advances.
			const willCompleteChapter =
				!view.chapterIdSet.has(chapter.externalId) &&
				chapterFilePaths.every((path) => path === filePath || view.filePathSet.has(path));
			if (willCompleteChapter) {
				view.markChapterViewed(chapter.externalId);
				advanceAfterChapterComplete();
			}
		},
		[view, chapter.externalId, chapterFilePaths, advanceAfterChapterComplete],
	);

	const defaultCollapsedIds = useMemo(() => {
		const ids = new Set<string>();
		for (const file of chapterFiles) {
			if (file.status === FILE_STATUS.DELETED) ids.add(file.path);
		}
		for (const path of view.filePathSet) {
			if (chapterFilePathSet.has(path)) ids.add(path);
		}
		return ids;
	}, [chapterFiles, chapterFilePathSet, view.filePathSet]);

	const collapseResetKey = `${runId}/${chapter.id}`;
	const collapseState = useFileCollapseState(
		defaultCollapsedIds,
		chapterFilePaths,
		collapseResetKey,
	);
	useProvideCollapseActions(collapseState, chapterFilePaths.length);

	const {
		diffListRef,
		currentFilePath,
		keyboardFocusedFilePath,
		selectFile,
		handleSelectFile,
		scrollToLine,
		cancelScrollToLine,
	} = useFileDiffNavigation({
		files: chapterFiles,
		onToggleViewed: handleToggleFileViewed,
		collapse: collapseState,
	});

	// On chapter change, realign the diff column to the new chapter's first file
	// (matches the hosted app). `resetScroll: false` keeps the prior scroll
	// offset, so when the user had scrolled down into the previous chapter the
	// new first file lands above the sticky header — snap it back under the
	// header. When already near the top (first file still below the header), the
	// view is left alone so the chapter summary stays in sight.
	const scrollAlignChapterRef = useRef(chapter.id);
	useLayoutEffect(() => {
		if (scrollAlignChapterRef.current === chapter.id) return;
		scrollAlignChapterRef.current = chapter.id;
		const firstPath = chapterFiles[0]?.path;
		if (!firstPath) return;
		const el = document.getElementById(`file-${firstPath}`);
		if (!el) return;
		const parsed = Number.parseFloat(getComputedStyle(el).getPropertyValue("--content-top"));
		const contentTop = Number.isFinite(parsed) ? parsed : 0;
		if (el.getBoundingClientRect().top < contentTop) {
			diffListRef.current?.scrollToFile(firstPath);
		}
	}, [chapter.id, chapterFiles, diffListRef]);

	const handleFocusKeyChange = useCallback(
		(keyChangeId: string | null, scrollTarget?: LineRef | null) => {
			setFocusedKeyChangeId(keyChangeId);
			if (!keyChangeId) {
				cancelScrollToLine();
				return;
			}
			const target = scrollTarget ?? findScrollTarget(chapter, keyChangeId);
			if (target) {
				scrollToLine(target.filePath, target.side, target.startLine);
				// Focus the file the key change lives in so file shortcuts act on it.
				selectFile(target.filePath);
			}
		},
		[chapter, scrollToLine, cancelScrollToLine, selectFile],
	);

	const handleChapterNavigate = useCallback(
		(direction: NavigationDirection) => {
			const targetIndex =
				direction === NAVIGATION_DIRECTION.NEXT ? chapterIndex + 1 : chapterIndex - 1;
			const target = allChapters[targetIndex];
			if (!target) return;
			void navigate({
				to: "/runs/$runId/chapters/$chapterNumber",
				params: { runId, chapterNumber: String(target.order) },
				// Keep scroll position when stepping chapters via the keyboard
				// (matches the hosted app); the default would jump to the top.
				resetScroll: false,
			});
		},
		[allChapters, chapterIndex, navigate, runId],
	);
	useChapterNavigationKeys(handleChapterNavigate);

	useHotkeys(
		KEYBOARD_SHORTCUTS.MARK_CHAPTER_AS_VIEWED.hotkey,
		() => handleToggleChapterViewed(chapter.externalId),
		{
			preventDefault: true,
			enableOnFormTags: false,
		},
		[handleToggleChapterViewed, chapter.externalId],
	);

	const handleCopyChapter = useCallback(() => {
		const markdown = formatChapterAsMarkdown(chapter, chapterEntries);
		void navigator.clipboard.writeText(markdown);
	}, [chapter, chapterEntries]);

	const chapterOverlay = useMemo<ChapterOverlayProps>(
		() => ({
			allLineRefsByFile,
			focusedLineRefsByFile,
			focusedKeyChangeId,
			isKeyChangeChecked: view.isKeyChangeChecked,
			onMarkKeyChangeChecked: view.markKeyChangeChecked,
			onUnmarkKeyChangeChecked: view.unmarkKeyChangeChecked,
			onFocusKeyChange: handleFocusKeyChange,
		}),
		[
			allLineRefsByFile,
			focusedLineRefsByFile,
			focusedKeyChangeId,
			view.isKeyChangeChecked,
			view.markKeyChangeChecked,
			view.unmarkKeyChangeChecked,
			handleFocusKeyChange,
		],
	);

	return (
		<SidebarLayout
			sidebar={
				<ChapterSidePanel
					chapter={chapter}
					chapterIndex={chapterIndex}
					files={chapterFiles}
					focusedFilePath={currentFilePath}
					viewedChapterIds={view.chapterIdSet}
					checkedKeyChangeIds={view.keyChangeIdSet}
					viewedFilePathSet={view.filePathSet}
					focusedKeyChangeId={focusedKeyChangeId}
					onToggleChapterViewed={handleToggleChapterViewed}
					onToggleKeyChangeChecked={handleToggleKeyChangeChecked}
					onToggleFileViewed={handleToggleFileViewed}
					onFocusKeyChange={(id) => handleFocusKeyChange(id)}
					onSelectFile={handleSelectFile}
					onCopyChapter={handleCopyChapter}
				/>
			}
		>
			<FileDiffList
				key={chapter.id}
				ref={diffListRef}
				entries={chapterEntries}
				emptyMessage="No changes in this chapter"
				viewedPathSet={view.filePathSet}
				onToggleViewed={handleToggleFileViewed}
				collapseState={collapseState}
				chapterOverlay={chapterOverlay}
				focusedFilePath={keyboardFocusedFilePath}
			/>
		</SidebarLayout>
	);
}

function findScrollTarget(chapter: Chapter, keyChangeId: string | null): LineRef | undefined {
	if (!keyChangeId) return undefined;
	const kc = chapter.keyChanges.find((k) => k.externalId === keyChangeId);
	if (!kc) return undefined;
	const sorted = sortLineRefsByChapterOrder(kc.lineRefs, chapter.hunkRefs);
	return sorted[0];
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
			<h2 className="mb-2 font-semibold text-base">Couldn't load chapter</h2>
			<p className="mb-4 max-w-md text-center text-muted-foreground text-sm">{message}</p>
			<Button variant="outline" size="sm" asChild>
				<Link to="/runs/$runId" params={{ runId }}>
					Back to chapters
				</Link>
			</Button>
		</div>
	);
}

function NotFoundState({ runId }: { runId: string }) {
	return (
		<div className="flex flex-col items-center justify-center p-12">
			<h2 className="mb-2 font-semibold text-base">Chapter not found</h2>
			<p className="mb-4 text-muted-foreground text-sm">This chapter doesn't exist in this run.</p>
			<Button variant="outline" size="sm" asChild>
				<Link to="/runs/$runId" params={{ runId }}>
					Back to chapters
				</Link>
			</Button>
		</div>
	);
}
