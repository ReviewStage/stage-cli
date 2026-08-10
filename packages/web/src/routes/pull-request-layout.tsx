import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
	BookOpen,
	FileText,
	FoldVertical,
	MessagesSquare,
	Settings2,
	UnfoldVertical,
} from "lucide-react";
import { type CSSProperties, useCallback, useMemo, useRef, useState } from "react";
import { isDiscussionEvent } from "@/components/conversation";
import { DiffSettingsForm } from "@/components/diff/diff-settings-form";
import { PullRequestHeader } from "@/components/pull-request/pull-request-header";
import { PullRequestHeaderSkeleton } from "@/components/pull-request/pull-request-header-skeleton";
import { ReviewPanel } from "@/components/pull-request/review-panel";
import { SectionLabel } from "@/components/pull-request/section-label";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ChapterProvider } from "@/lib/chapter-context";
import { ChapterViewStateProvider } from "@/lib/chapter-view-state-context";
import { CollapseActionsProvider, useCollapseActionsFromNav } from "@/lib/collapse-actions-context";
import { useFileDiffEntries } from "@/lib/parse-diff";
import { PullRequestProvider } from "@/lib/pull-request-context";
import {
	buildHunkIndex,
	collectViewedChapterHunkRefs,
	computeFileLineCounts,
	computeRemainingPullRequestLineCounts,
	type HunkIndex,
	type LineCounts,
} from "@/lib/remaining-line-counts";
import { useChapters } from "@/lib/use-chapters";
import { useDiffPatch } from "@/lib/use-diff-patch";
import { usePullRequest, usePullRequestMergeStatus } from "@/lib/use-pull-request";
import { useTimeline } from "@/lib/use-timeline";
import { countViewedChapters, useViewStateData } from "@/lib/use-view-state";
import { cn } from "@/lib/utils";

const PR_TAB = {
	CHAPTERS: "chapters",
	ACTIVITY: "activity",
	FILES: "files",
} as const;
type PrTab = (typeof PR_TAB)[keyof typeof PR_TAB];

// The topbar's h-12 (48px). The contained layout reserves it so the page itself
// never scrolls — only the prologue/chapters panels do.
const TOPBAR_PX = 48;

// Mirrors hosted's tab order: Chapters, Activity, Files changed. The Activity
// tab is a GitHub-only affordance and is offered only for PR runs.
const tabs = [
	{ id: PR_TAB.CHAPTERS, label: "Chapters", icon: BookOpen, to: "/runs/$runId" as const },
	{
		id: PR_TAB.ACTIVITY,
		label: "Activity",
		icon: MessagesSquare,
		to: "/runs/$runId/activity" as const,
	},
	{
		id: PR_TAB.FILES,
		label: "Files changed",
		icon: FileText,
		to: "/runs/$runId/files" as const,
	},
];

interface TabLinkProps {
	tab: (typeof tabs)[number];
	runId: string;
	isActive: boolean;
	countLabel?: string;
}

function TabLink({ tab, runId, isActive, countLabel }: TabLinkProps) {
	const { icon: Icon, label, to } = tab;
	return (
		<Link
			to={to}
			params={{ runId }}
			className={cn(
				"flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 font-medium text-sm transition-colors",
				isActive
					? "bg-accent text-foreground"
					: "text-muted-foreground hover:bg-accent hover:text-foreground",
			)}
		>
			<Icon className={cn("size-4", isActive && "text-primary")} aria-hidden="true" />
			<span>{label}</span>
			{countLabel !== undefined && (
				<span className="text-muted-foreground text-xs tabular-nums">{countLabel}</span>
			)}
		</Link>
	);
}

interface HeaderLineCounts {
	counts: LineCounts;
	/** Present only when `counts` is the remaining (not total) lines. */
	totalCounts?: LineCounts;
}

function LineCountValues({ counts }: { counts: LineCounts }) {
	return (
		<>
			<span className="font-medium text-green-600 tabular-nums dark:text-green-500">
				+{counts.linesAdded.toLocaleString()}
			</span>
			<span className="font-medium text-red-600 tabular-nums dark:text-red-500">
				-{counts.linesDeleted.toLocaleString()}
			</span>
		</>
	);
}

function HeaderLineCountsDisplay({ lineCounts }: { lineCounts: HeaderLineCounts }) {
	if (!lineCounts.totalCounts) {
		return <LineCountValues counts={lineCounts.counts} />;
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<div className="flex items-center gap-3 rounded-md border border-border bg-muted/40 px-2.5 py-1">
					<LineCountValues counts={lineCounts.counts} />
					<span className="font-medium text-muted-foreground text-xs">left</span>
				</div>
			</TooltipTrigger>
			<TooltipContent>
				<div className="flex items-center gap-3">
					<LineCountValues counts={lineCounts.totalCounts} />
					<span className="font-medium text-muted-foreground text-xs">total</span>
				</div>
			</TooltipContent>
		</Tooltip>
	);
}

function CollapseExpandAllButton() {
	const actions = useCollapseActionsFromNav();
	if (!actions) return null;

	const { collapseState, fileCount } = actions;
	const allCollapsed = fileCount > 0 && collapseState.collapsedFiles.size >= fileCount;
	const handleClick = allCollapsed ? collapseState.expandAllFiles : collapseState.collapseAllFiles;
	const label = allCollapsed ? "Expand all files" : "Collapse all files";

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					className="h-7 cursor-pointer px-2"
					aria-label={label}
					onClick={handleClick}
				>
					{allCollapsed ? (
						<UnfoldVertical className="size-3.5" />
					) : (
						<FoldVertical className="size-3.5" />
					)}
					<span className="ml-1 hidden text-xs @7xl:inline">
						{allCollapsed ? "Expand all" : "Collapse all"}
					</span>
				</Button>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

function ErrorState({ error }: { error: unknown }) {
	return (
		<div className="flex flex-1 items-center justify-center p-6">
			<div className="max-w-md text-center">
				<h1 className="font-semibold text-lg">Couldn't load chapters</h1>
				<p className="mt-2 text-muted-foreground text-sm">
					{error instanceof Error ? error.message : String(error)}
				</p>
			</div>
		</div>
	);
}

export function PullRequestLayout({ runId }: { runId: string }) {
	const { data, error } = useChapters(runId);
	const { data: prData, isLoading: isPrLoading } = usePullRequest(runId);
	const pullRequest = prData?.pullRequest ?? null;
	const isPrOpen =
		pullRequest !== null &&
		pullRequest.state === "open" &&
		!pullRequest.merged_at &&
		!pullRequest.draft;
	const { data: mergeStatusData } = usePullRequestMergeStatus(
		runId,
		pullRequest?.number ?? null,
		isPrOpen,
	);
	const activeTab = useRouterState({
		select: (state): PrTab => {
			const routeIds = new Set(state.matches.map((match) => match.routeId));
			if (routeIds.has("/runs/$runId/activity")) return PR_TAB.ACTIVITY;
			if (routeIds.has("/runs/$runId/files")) return PR_TAB.FILES;
			return PR_TAB.CHAPTERS;
		},
	});
	// The chapters index uses contained scroll (the page is locked to the viewport
	// and only the panels scroll); files and chapter detail keep page scroll for
	// their long diff lists, where the header scrolls away under a sticky nav.
	const usesPageScroll = useRouterState({
		select: (state) => {
			const routeIds = state.matches.map((match) => match.routeId);
			return (
				routeIds.includes("/runs/$runId/files") ||
				routeIds.includes("/runs/$runId/chapters/$chapterNumber")
			);
		},
	});

	const { chapterIdSet, filePathSet } = useViewStateData(runId);
	const chapters = data?.chapters;
	const viewedChapterCount = useMemo(
		() => countViewedChapters(chapters, chapterIdSet),
		[chapters, chapterIdSet],
	);

	// Fetched here so the Files tab's "N/M viewed" label can render before the
	// user clicks into the tab; react-query dedupes the same fetch from FilesPage.
	const { data: diffData } = useDiffPatch(runId);
	const fileEntries = useFileDiffEntries(diffData?.patch, diffData?.fileContents);
	const totalFileCount = fileEntries.length;
	const viewedFileCount = useMemo(() => {
		if (totalFileCount === 0) return 0;
		let n = 0;
		for (const entry of fileEntries) {
			if (filePathSet.has(entry.file.path)) n++;
		}
		return n;
	}, [fileEntries, filePathSet, totalFileCount]);

	// `undefined` while loading so the count chip is suppressed entirely;
	// otherwise the bare total until at least one item is viewed.
	const chapterCountLabel = (() => {
		if (chapters === undefined) return undefined;
		if (viewedChapterCount > 0) return `${viewedChapterCount}/${chapters.length} viewed`;
		return String(chapters.length);
	})();

	const fileCountLabel = (() => {
		if (diffData === undefined) return undefined;
		if (viewedFileCount > 0) return `${viewedFileCount}/${totalFileCount} viewed`;
		return String(totalFileCount);
	})();

	// Comment count for the Activity tab (issue comments + reviews), suppressed
	// until the timeline loads. React-query dedupes this with the Activity page.
	const { data: timelineData } = useTimeline(runId, pullRequest?.number ?? null);
	const activityCountLabel = (() => {
		const timeline = timelineData?.timeline;
		if (timeline === undefined) return undefined;
		return String(timeline.events.filter(isDiscussionEvent).length);
	})();

	// The Activity tab is meaningless for local (non-PR) runs — gate it like the
	// PR header and other GitHub-only affordances.
	const visibleTabs = pullRequest ? tabs : tabs.filter((tab) => tab.id !== PR_TAB.ACTIVITY);

	// Page-scroll tabs read `--content-top` (topbar + sticky nav) to pin their own
	// sticky content; the contained index instead measures the content area height
	// so its panels can size to it via `--main-height`. Callback refs re-attach the
	// observers cleanly as the content element swaps between the two scroll modes.
	const [navHeight, setNavHeight] = useState(0);
	const navObserverRef = useRef<ResizeObserver | null>(null);
	const navRef = useCallback((node: HTMLElement | null) => {
		navObserverRef.current?.disconnect();
		navObserverRef.current = null;
		if (node) {
			const observer = new ResizeObserver(() => setNavHeight(node.offsetHeight));
			observer.observe(node);
			navObserverRef.current = observer;
			setNavHeight(node.offsetHeight);
		}
	}, []);

	const [contentHeight, setContentHeight] = useState(0);
	const contentObserverRef = useRef<ResizeObserver | null>(null);
	const contentRef = useCallback((node: HTMLDivElement | null) => {
		contentObserverRef.current?.disconnect();
		contentObserverRef.current = null;
		if (node) {
			const observer = new ResizeObserver(() => setContentHeight(node.clientHeight));
			observer.observe(node);
			contentObserverRef.current = observer;
			setContentHeight(node.clientHeight);
		}
	}, []);

	// The hunk index is built once from the stable diff so viewed toggles only
	// pay for the subtraction, letting the badge update in the same render as
	// the optimistic viewed-state cache writes.
	const files = useMemo(() => fileEntries.map((entry) => entry.file), [fileEntries]);
	const hunkIndex = useMemo<HunkIndex>(() => buildHunkIndex(files), [files]);

	const viewedChapterHunkRefs = useMemo(
		() => (chapters ? collectViewedChapterHunkRefs(chapters, chapterIdSet, filePathSet) : []),
		[chapters, chapterIdSet, filePathSet],
	);

	const headerLineCounts = useMemo<HeaderLineCounts | null>(() => {
		if (diffData === undefined) return null;

		// Unlike the hosted app (which anchors totals on GitHub's API and must
		// guard against the PR metadata and diff resolving for different heads),
		// the CLI's chapters, diff, and view-state all describe the same run, so
		// the parsed diff is both the total and the remaining baseline.
		const totalCounts = computeFileLineCounts(files);

		// A viewed file's lines are subtracted whole. Partially viewed chapters
		// are applied at the hunk level via viewedChapterHunkRefs so hunks a file
		// has outside its viewed chapters are not subtracted until they are
		// actually reviewed.
		const remainingCounts = computeRemainingPullRequestLineCounts(
			files,
			(path) => filePathSet.has(path),
			viewedChapterHunkRefs,
			hunkIndex,
		);

		// Show the plain total unless there is real reviewed progress with lines
		// still left. Gating on the computed remaining lines (rather than a
		// separate viewed-file count) means the badge never labels the full diff
		// as "left".
		const hasViewedLines =
			remainingCounts.linesAdded < totalCounts.linesAdded ||
			remainingCounts.linesDeleted < totalCounts.linesDeleted;
		const hasLinesLeft = remainingCounts.linesAdded > 0 || remainingCounts.linesDeleted > 0;
		if (!hasViewedLines || !hasLinesLeft) {
			return { counts: totalCounts };
		}

		return { counts: remainingCounts, totalCounts };
	}, [diffData, files, filePathSet, viewedChapterHunkRefs, hunkIndex]);

	if (error) return <ErrorState error={error} />;

	return (
		<ChapterViewStateProvider>
			<CollapseActionsProvider>
				<div
					className={cn(
						"@container flex flex-col px-6 pt-6 lg:px-8",
						usesPageScroll ? "flex-1" : "h-[calc(100vh_-_3rem)] overflow-hidden",
					)}
				>
					<div className={cn("mb-4", !usesPageScroll && "shrink-0")}>
						{isPrLoading ? (
							<PullRequestHeaderSkeleton />
						) : pullRequest ? (
							<PullRequestProvider runId={runId} pullRequest={pullRequest}>
								<PullRequestHeader
									pullRequest={pullRequest}
									mergeInfo={mergeStatusData?.mergeStatus ?? undefined}
								/>
							</PullRequestProvider>
						) : (
							<header className="space-y-1">
								<SectionLabel>Run</SectionLabel>
								<p className="break-all font-mono text-foreground/80 text-xs">
									{data?.run.id ?? runId}
								</p>
							</header>
						)}
					</div>
					<nav
						ref={navRef}
						className={cn(
							"z-20 flex items-center justify-between gap-4 py-2",
							usesPageScroll
								? "-mx-6 lg:-mx-8 sticky top-12 mb-6 bg-background px-6 lg:px-8"
								: "mb-6 shrink-0",
						)}
					>
						<div className="flex shrink-0 items-center gap-1">
							{visibleTabs.map((tab) => (
								<TabLink
									key={tab.id}
									tab={tab}
									runId={runId}
									isActive={tab.id === activeTab}
									countLabel={
										tab.id === PR_TAB.CHAPTERS
											? chapterCountLabel
											: tab.id === PR_TAB.ACTIVITY
												? activityCountLabel
												: tab.id === PR_TAB.FILES
													? fileCountLabel
													: undefined
									}
								/>
							))}
						</div>
						<div className="flex shrink-0 items-center gap-3 text-sm @xl:gap-6">
							<CollapseExpandAllButton />
							<ReviewPanel key={runId} />
							<Popover>
								<Tooltip>
									<TooltipTrigger asChild>
										<PopoverTrigger asChild>
											<Button
												variant="outline"
												size="sm"
												className="h-7 cursor-pointer px-2"
												aria-label="Display settings"
											>
												<Settings2 className="size-3.5" />
												<span className="ml-1 hidden text-xs @7xl:inline">Display</span>
											</Button>
										</PopoverTrigger>
									</TooltipTrigger>
									<TooltipContent>Display settings</TooltipContent>
								</Tooltip>
								<PopoverContent align="end" className="w-80">
									<DiffSettingsForm compact />
								</PopoverContent>
							</Popover>
							<div className="hidden items-center gap-3 @5xl:flex">
								{headerLineCounts ? (
									<HeaderLineCountsDisplay lineCounts={headerLineCounts} />
								) : (
									<>
										<Skeleton className="h-4 w-12" />
										<Skeleton className="h-4 w-12" />
									</>
								)}
							</div>
						</div>
					</nav>
					<ChapterProvider runId={runId}>
						{usesPageScroll ? (
							<div
								style={
									{
										"--content-top": `${TOPBAR_PX + navHeight}px`,
										"--main-height": "100vh",
									} as CSSProperties
								}
							>
								<Outlet />
							</div>
						) : (
							<div
								ref={contentRef}
								className="scrollbar-thin min-h-0 flex-1 overflow-y-auto"
								style={
									{
										"--content-top": "0px",
										"--main-height": `${contentHeight}px`,
									} as CSSProperties
								}
							>
								<Outlet />
							</div>
						)}
					</ChapterProvider>
				</div>
			</CollapseActionsProvider>
		</ChapterViewStateProvider>
	);
}
