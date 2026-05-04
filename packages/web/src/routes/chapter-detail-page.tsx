import type { Chapter, LineRef } from "@stage-cli/types/chapters";
import { Link } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { ChapterSidePanel } from "@/components/chapter";
import {
	type ChapterOverlayProps,
	FileDiffList,
	type FileDiffListHandle,
	SidebarLayout,
} from "@/components/files";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FILE_STATUS } from "@/lib/diff-types";
import { filterFilesForChapter } from "@/lib/filter-files-for-chapter";
import { groupAnnotatedLineRefsByFile, groupLineRefsByFile } from "@/lib/line-refs-by-file";
import { sortLineRefsByChapterOrder } from "@/lib/sort-line-refs";
import { useChapters } from "@/lib/use-chapters";
import { useDiffPatch } from "@/lib/use-diff-patch";
import { useFileCollapseState } from "@/lib/use-file-collapse-state";
import { useFileNavigationKeys } from "@/lib/use-file-navigation-keys";
import { useViewState } from "@/lib/use-view-state";

interface ChapterDetailPageProps {
	runId: string;
	chapterNumber: number | null;
}

export function ChapterDetailPage({ runId, chapterNumber }: ChapterDetailPageProps) {
	const {
		data: chaptersData,
		isLoading: chaptersLoading,
		error: chaptersError,
	} = useChapters(runId);
	const { data: patch, isLoading: patchLoading, error: patchError } = useDiffPatch(runId);

	const allChapters = useMemo<Chapter[]>(() => {
		if (!chaptersData?.chapters) return [];
		return [...chaptersData.chapters].sort((a, b) => a.order - b.order);
	}, [chaptersData?.chapters]);
	const chapterIndex = chapterNumber === null ? -1 : chapterNumber - 1;
	const chapter = chapterIndex >= 0 ? allChapters[chapterIndex] : undefined;

	const isLoading = chaptersLoading || patchLoading;
	const error = chaptersError ?? patchError;

	if (chapterNumber === null) return <NotFoundState runId={runId} />;
	if (error) return <ErrorState runId={runId} error={error} />;
	if (isLoading) return <LoadingState />;
	if (!chapter) return <NotFoundState runId={runId} />;
	if (!patch) return <ErrorState runId={runId} error={new Error("Diff patch unavailable")} />;

	return (
		<ChapterDetailContent
			runId={runId}
			chapter={chapter}
			chapterIndex={chapterIndex}
			allChapters={allChapters}
			patch={patch}
		/>
	);
}

interface ChapterDetailContentProps {
	runId: string;
	chapter: Chapter;
	chapterIndex: number;
	allChapters: Chapter[];
	patch: string;
}

function ChapterDetailContent({
	runId,
	chapter,
	chapterIndex,
	allChapters,
	patch,
}: ChapterDetailContentProps) {
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
		() => filterFilesForChapter(patch, chapter.hunkRefs),
		[patch, chapter.hunkRefs],
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

	const handleSelectFile = useCallback((filePath: string) => {
		diffListRef.current?.scrollToFile(filePath);
	}, []);

	const handleToggleKeyChangeChecked = useCallback(
		(keyChangeId: string) => {
			if (view.keyChangeIdSet.has(keyChangeId)) view.unmarkKeyChangeChecked(keyChangeId);
			else view.markKeyChangeChecked(keyChangeId);
		},
		[view],
	);

	const handleToggleChapterViewed = useCallback(
		(externalId: string) => {
			if (view.chapterIdSet.has(externalId)) view.unmarkChapterViewed(externalId);
			else view.markChapterViewed(externalId);
		},
		[view],
	);

	const handleToggleFileViewed = useCallback(
		(filePath: string) => {
			if (view.filePathSet.has(filePath)) view.unmarkFileViewed(filePath);
			else view.markFileViewed(filePath);
		},
		[view],
	);

	const handleFocusKeyChange = useCallback(
		(keyChangeId: string | null, scrollTarget?: LineRef | null) => {
			setFocusedKeyChangeId(keyChangeId);
			const target = scrollTarget ?? findScrollTarget(chapter, keyChangeId);
			if (target) {
				diffListRef.current?.scrollToFile(target.filePath);
			}
		},
		[chapter],
	);

	const diffListRef = useRef<FileDiffListHandle>(null);

	const chapterFiles = useMemo(() => chapterEntries.map((e) => e.file), [chapterEntries]);
	const chapterFilePaths = useMemo(() => chapterFiles.map((f) => f.path), [chapterFiles]);
	const chapterFilePathSet = useMemo(() => new Set(chapterFilePaths), [chapterFilePaths]);

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

	useFileNavigationKeys(chapterFiles, undefined, handleSelectFile);

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
					runId={runId}
					chapter={chapter}
					chapterIndex={chapterIndex}
					allChapters={allChapters}
					chapterEntries={chapterEntries}
					viewedChapterIds={view.chapterIdSet}
					checkedKeyChangeIds={view.keyChangeIdSet}
					viewedFilePathSet={view.filePathSet}
					focusedKeyChangeId={focusedKeyChangeId}
					onToggleChapterViewed={handleToggleChapterViewed}
					onToggleKeyChangeChecked={handleToggleKeyChangeChecked}
					onToggleFileViewed={handleToggleFileViewed}
					onFocusKeyChange={(id) => handleFocusKeyChange(id)}
					onSelectFile={handleSelectFile}
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
