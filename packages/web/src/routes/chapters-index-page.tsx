import type { Chapter } from "@stagereview/types/chapters";
import { Link, useNavigate } from "@tanstack/react-router";
import {
	ArrowRight,
	ChevronRight,
	Circle,
	CircleCheck,
	FileCode,
	MessageSquare,
} from "lucide-react";
import { useCallback, useMemo } from "react";
import { RiskBadge } from "@/components/chapter/risk-badge";
import { OverviewColumnHeader } from "@/components/pull-request/overview-column-header";
import { SectionLabel } from "@/components/pull-request/section-label";
import { CopyMarkdownButton } from "@/components/shared/copy-markdown-button";
import { LineCounts } from "@/components/shared/line-counts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useChapterContext } from "@/lib/chapter-context";
import { formatAllChaptersAsMarkdown } from "@/lib/format-chapter-markdown";
import {
	NAVIGATION_DIRECTION,
	type NavigationDirection,
	useChapterNavigationKeys,
} from "@/lib/use-chapter-navigation-keys";
import { useDiffPatch } from "@/lib/use-diff-patch";
import { useViewState } from "@/lib/use-view-state";
import { cn } from "@/lib/utils";

function ChapterLoadingSkeleton() {
	return (
		<div className="space-y-3">
			<Skeleton className="h-16 w-full" />
			<Skeleton className="h-16 w-full" />
			<Skeleton className="h-16 w-full" />
		</div>
	);
}

function ChaptersList({ chapters, runId }: { chapters: Chapter[]; runId: string }) {
	const { chapterLineCountsMap, chapterCommentCounts } = useChapterContext();
	const view = useViewState(runId);

	const sorted = useMemo(() => [...chapters].sort((a, b) => a.order - b.order), [chapters]);

	const total = sorted.length;
	const viewedCount = sorted.reduce(
		(count, ch) => (view.isChapterViewed(ch.externalId) ? count + 1 : count),
		0,
	);
	const firstUnviewedIndex =
		viewedCount === total ? -1 : sorted.findIndex((ch) => !view.isChapterViewed(ch.externalId));

	return (
		<div className="divide-y divide-border overflow-hidden rounded-lg border">
			{sorted.map((ch, index) => {
				const isViewed = view.isChapterViewed(ch.externalId);
				const counts = chapterLineCountsMap.get(ch.id);
				const commentCount = chapterCommentCounts.get(ch.id) ?? 0;
				const fileCount = new Set(ch.hunkRefs.map((h) => h.filePath)).size;
				const isNextToReview = index === firstUnviewedIndex;

				return (
					<div
						key={ch.id}
						className="group relative flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-accent/50"
					>
						<Link
							to="/runs/$runId/chapters/$chapterNumber"
							params={{ runId, chapterNumber: String(ch.order + 1) }}
							aria-label={`Go to chapter ${ch.order + 1}: ${ch.title}`}
							className={cn(
								"absolute inset-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
								index === 0 && "rounded-t-lg",
								index === total - 1 && "rounded-b-lg",
							)}
						/>

						<Tooltip>
							<TooltipTrigger asChild>
								<button
									type="button"
									onClick={() => {
										if (isViewed) {
											// A chapter can read as viewed purely because all of its
											// files are viewed, so unmarking must also clear those
											// file views (mirrors the hosted toggle, which unmarks a
											// chapter's files with it) or the unmark is a no-op.
											view.unmarkChapterViewed(ch.externalId);
											for (const path of new Set(ch.hunkRefs.map((h) => h.filePath))) {
												if (view.isFileViewed(path)) view.unmarkFileViewed(path);
											}
										} else {
											view.markChapterViewed(ch.externalId);
										}
									}}
									className={cn(
										"relative z-10 shrink-0 cursor-pointer rounded-sm p-0.5 transition-colors hover:bg-accent",
										isViewed
											? "text-green-600 hover:text-green-700 dark:text-green-500 dark:hover:text-green-400"
											: "text-muted-foreground hover:text-foreground",
									)}
									aria-label={isViewed ? "Unmark as viewed" : "Mark as viewed"}
								>
									{isViewed ? <CircleCheck className="size-4" /> : <Circle className="size-4" />}
								</button>
							</TooltipTrigger>
							<TooltipContent side="top">
								{isViewed ? "Unmark as viewed" : "Mark as viewed"}
							</TooltipContent>
						</Tooltip>

						<div className="flex min-w-0 flex-1 items-center gap-3">
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									<span className="shrink-0 text-muted-foreground text-xs">{ch.order + 1}</span>
									<span
										className={cn(
											"truncate font-medium text-foreground text-sm group-hover:text-primary",
											isViewed && "text-muted-foreground",
										)}
									>
										{ch.title}
									</span>
								</div>
								<div className="mt-0.5 flex items-center gap-1.5 text-muted-foreground text-xs">
									{ch.riskLevel !== null && <RiskBadge level={ch.riskLevel} />}
									{counts && (
										<LineCounts
											additions={counts.linesAdded}
											deletions={counts.linesDeleted}
											className="font-mono text-[11px]"
										/>
									)}
									{fileCount > 0 && (
										<span className="flex items-center gap-0.5">
											<FileCode className="size-3" />
											{fileCount}
										</span>
									)}
								</div>
							</div>

							{commentCount > 0 && (
								<span className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
									<MessageSquare className="size-3" />
									{commentCount}
								</span>
							)}

							{isNextToReview ? (
								<Button size="sm" asChild className="pointer-events-none shrink-0 gap-1.5">
									<span>
										{viewedCount > 0 ? "Continue reviewing" : "Start reviewing"}
										<ArrowRight className="size-3.5" />
									</span>
								</Button>
							) : (
								<ChevronRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
							)}
						</div>
					</div>
				);
			})}
		</div>
	);
}

/**
 * Mirrors the hosted app's ChapterNavigationShortcuts on the pull index page:
 * with no chapter selected, "next" navigates into the first chapter and "prev"
 * is a no-op.
 */
function ChapterNavigationShortcuts({ chapters, runId }: { chapters: Chapter[]; runId: string }) {
	const navigate = useNavigate();
	const firstChapter = useMemo(
		() => [...chapters].sort((a, b) => a.order - b.order)[0],
		[chapters],
	);

	const handleNavigate = useCallback(
		(direction: NavigationDirection) => {
			if (direction !== NAVIGATION_DIRECTION.NEXT || !firstChapter) return;
			void navigate({
				to: "/runs/$runId/chapters/$chapterNumber",
				params: { runId, chapterNumber: String(firstChapter.order + 1) },
			});
		},
		[firstChapter, navigate, runId],
	);

	useChapterNavigationKeys(handleNavigate, chapters.length > 0);

	return null;
}

interface ChaptersIndexPageProps {
	chapters: Chapter[] | undefined;
	runId: string;
	isLoading: boolean;
}

export function ChaptersIndexPage({ chapters, runId, isLoading }: ChaptersIndexPageProps) {
	const { data: diffData } = useDiffPatch(runId);
	// Gate on the diff query having settled, not on a non-empty patch, so the button
	// still shows for a legitimately empty diff (the formatter just omits file sections).
	const diffLoaded = diffData !== undefined;
	const hasChapters = (chapters?.length ?? 0) > 0;
	const copyChapters = useCallback(
		() => (chapters ? formatAllChaptersAsMarkdown(chapters, diffData?.patch ?? "") : null),
		[chapters, diffData?.patch],
	);

	return (
		<div>
			{chapters && <ChapterNavigationShortcuts chapters={chapters} runId={runId} />}
			<OverviewColumnHeader>
				<SectionLabel>Chapters</SectionLabel>
				{/* Shown once the diff has loaded so a copy includes the per-chapter
				    file lists (the patch drives them). Mirrors hosted's onCopy gate. */}
				{hasChapters && diffLoaded && (
					<CopyMarkdownButton getMarkdown={copyChapters} label="chapters" />
				)}
			</OverviewColumnHeader>
			{isLoading || !chapters ? (
				<ChapterLoadingSkeleton />
			) : chapters.length === 0 ? null : (
				<ChaptersList chapters={chapters} runId={runId} />
			)}
		</div>
	);
}
