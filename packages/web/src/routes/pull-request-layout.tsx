import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { BookOpen, FileText, FoldVertical, Settings2, UnfoldVertical } from "lucide-react";
import { type CSSProperties, useCallback, useMemo, useRef, useState } from "react";
import { DiffSettingsForm } from "@/components/diff/diff-settings-form";
import { PullRequestHeader } from "@/components/pull-request/pull-request-header";
import { PullRequestHeaderSkeleton } from "@/components/pull-request/pull-request-header-skeleton";
import { SectionLabel } from "@/components/pull-request/section-label";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ChapterProvider } from "@/lib/chapter-context";
import { CollapseActionsProvider, useCollapseActionsFromNav } from "@/lib/collapse-actions-context";
import { useFileDiffEntries } from "@/lib/parse-diff";
import { PullRequestProvider } from "@/lib/pull-request-context";
import { useChapters } from "@/lib/use-chapters";
import { useDiffPatch } from "@/lib/use-diff-patch";
import { usePullRequest, usePullRequestMergeStatus } from "@/lib/use-pull-request";
import { countViewedChapters, useViewStateData } from "@/lib/use-view-state";
import { cn } from "@/lib/utils";

const PR_TAB = {
	CHAPTERS: "chapters",
	FILES: "files",
} as const;
type PrTab = (typeof PR_TAB)[keyof typeof PR_TAB];

// The topbar's h-12 (48px). The contained layout reserves it so the page itself
// never scrolls — only the prologue/chapters panels do.
const TOPBAR_PX = 48;

const tabs = [
	{ id: PR_TAB.CHAPTERS, label: "Chapters", icon: BookOpen, to: "/runs/$runId" as const },
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
		select: (state): PrTab =>
			state.matches.some((match) => match.routeId === "/runs/$runId/files")
				? PR_TAB.FILES
				: PR_TAB.CHAPTERS,
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

	const { totalAdditions, totalDeletions } = useMemo(() => {
		let additions = 0;
		let deletions = 0;
		for (const entry of fileEntries) {
			additions += entry.file.additions;
			deletions += entry.file.deletions;
		}
		return { totalAdditions: additions, totalDeletions: deletions };
	}, [fileEntries]);

	if (error) return <ErrorState error={error} />;

	return (
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
						{tabs.map((tab) => (
							<TabLink
								key={tab.id}
								tab={tab}
								runId={runId}
								isActive={tab.id === activeTab}
								countLabel={
									tab.id === PR_TAB.CHAPTERS
										? chapterCountLabel
										: tab.id === PR_TAB.FILES
											? fileCountLabel
											: undefined
								}
							/>
						))}
					</div>
					<div className="flex shrink-0 items-center gap-3 text-sm @xl:gap-6">
						<CollapseExpandAllButton />
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
							<span className="font-medium text-green-600 dark:text-green-500">
								+{totalAdditions.toLocaleString()}
							</span>
							<span className="font-medium text-red-600 dark:text-red-500">
								-{totalDeletions.toLocaleString()}
							</span>
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
	);
}
