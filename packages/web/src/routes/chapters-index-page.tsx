import type { Chapter, HunkReference } from "@stage-cli/types/chapters";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Circle, CircleCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FileViewRow } from "@/components/chapter";
import { LineCounts } from "@/components/shared/line-counts";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type ChapterLineCounts, useChapterContext } from "@/lib/chapter-context";
import { useViewState } from "@/lib/use-view-state";
import { cn } from "@/lib/utils";

function ChapterLoadingSkeleton() {
	return (
		<div className="space-y-4">
			<Skeleton className="h-8 w-48" />
			<div className="space-y-3">
				<Skeleton className="h-16 w-full" />
				<Skeleton className="h-16 w-full" />
				<Skeleton className="h-16 w-full" />
			</div>
		</div>
	);
}

interface FileCollapsibleProps {
	fileCount: number;
	isOpen: boolean;
	onToggle: () => void;
	onToggleAll: () => void;
	children: React.ReactNode;
}

function FileCollapsible({
	fileCount,
	isOpen,
	onToggle,
	onToggleAll,
	children,
}: FileCollapsibleProps) {
	return (
		<Collapsible open={isOpen} onOpenChange={() => onToggle()} className="mt-1 ml-10">
			<CollapsibleTrigger
				onClick={(e) => {
					if (e.altKey) {
						e.preventDefault();
						onToggleAll();
					}
				}}
				className="flex w-full cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground"
			>
				<ChevronRight
					className={cn("size-3 shrink-0 transition-transform duration-200", isOpen && "rotate-90")}
				/>
				{fileCount} {fileCount === 1 ? "file" : "files"}
			</CollapsibleTrigger>
			<CollapsibleContent className="space-y-0">{children}</CollapsibleContent>
		</Collapsible>
	);
}

interface ChapterEntryProps {
	chapter: Chapter;
	isViewed: boolean;
	filePaths: string[];
	isFilesOpen: boolean;
	runId: string;
	lineCounts: ChapterLineCounts | undefined;
	onToggleViewed: () => void;
	onToggleFiles: () => void;
	onToggleAllFiles: () => void;
}

function ChapterEntry({
	chapter,
	isViewed,
	filePaths,
	isFilesOpen,
	runId,
	lineCounts,
	onToggleViewed,
	onToggleFiles,
	onToggleAllFiles,
}: ChapterEntryProps) {
	return (
		<div>
			<div className="flex w-full items-start gap-3 text-left">
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={onToggleViewed}
							className={cn(
								"mt-0.5 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent",
								isViewed
									? "text-green-600 hover:text-green-700 dark:text-green-500 dark:hover:text-green-400"
									: "text-muted-foreground hover:text-foreground",
							)}
							aria-label={isViewed ? "Unmark as viewed" : "Mark as viewed"}
						>
							{isViewed ? <CircleCheck className="size-3.5" /> : <Circle className="size-3.5" />}
						</button>
					</TooltipTrigger>
					<TooltipContent side="top">
						{isViewed ? "Unmark as viewed" : "Mark as viewed"}
					</TooltipContent>
				</Tooltip>
				<Link
					to="/runs/$runId/chapters/$chapterNumber"
					params={{ runId, chapterNumber: String(chapter.order) }}
					className="min-w-0 flex-1 overflow-hidden rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
					style={{
						backgroundImage:
							"radial-gradient(circle, color-mix(in oklch, var(--muted-foreground) 30%, transparent) 1px, transparent 1px)",
						backgroundSize: "6px 1em",
						backgroundRepeat: "repeat-x",
						backgroundPosition: "0 calc(100% - 0.35em)",
					}}
				>
					{lineCounts && (
						<LineCounts
							additions={lineCounts.linesAdded}
							deletions={lineCounts.linesDeleted}
							className="float-right clear-right bg-background pl-1.5 font-mono text-xs text-muted-foreground"
						/>
					)}
					<span
						className={cn(
							"[box-decoration-break:clone] bg-background pr-1.5 font-semibold text-base hover:underline",
							isViewed && "text-muted-foreground",
						)}
					>
						{chapter.order}. {chapter.title}
					</span>
				</Link>
			</div>

			{filePaths.length > 0 && (
				<FileCollapsible
					fileCount={filePaths.length}
					isOpen={isFilesOpen}
					onToggle={onToggleFiles}
					onToggleAll={onToggleAllFiles}
				>
					{filePaths.map((p) => (
						<FileViewRow key={p} filePath={p} />
					))}
				</FileCollapsible>
			)}
		</div>
	);
}

function distinctFilePaths(hunkRefs: HunkReference[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const h of hunkRefs) {
		if (!seen.has(h.filePath)) {
			seen.add(h.filePath);
			out.push(h.filePath);
		}
	}
	return out;
}

interface ChaptersListProps {
	chapters: Chapter[];
	runId: string;
	viewedCount: number;
}

function ChaptersList({ chapters, runId, viewedCount }: ChaptersListProps) {
	const { chapterLineCountsMap } = useChapterContext();
	const view = useViewState(runId);
	const [openFiles, setOpenFiles] = useState<Set<string>>(() => new Set());
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		requestAnimationFrame(() => setMounted(true));
	}, []);

	const filePathsByChapter = useMemo(() => {
		const map = new Map<string, string[]>();
		for (const c of chapters) map.set(c.id, distinctFilePaths(c.hunkRefs));
		return map;
	}, [chapters]);

	const toggleFiles = useCallback((chapterId: string) => {
		setOpenFiles((prev) => {
			const next = new Set(prev);
			if (next.has(chapterId)) next.delete(chapterId);
			else next.add(chapterId);
			return next;
		});
	}, []);

	// Alt-click: collapse all when this chapter was open, expand all otherwise.
	// Mirrors the hosted toggleAllFiles behavior.
	const toggleAllFiles = useCallback(
		(chapterId: string) => {
			setOpenFiles((prev) => {
				if (prev.has(chapterId)) return new Set();
				return new Set(chapters.map((c) => c.id));
			});
		},
		[chapters],
	);

	const totalCount = chapters.length;

	return (
		<div>
			<div className="mt-3 mb-6 flex items-center gap-3">
				<Progress
					value={mounted && totalCount > 0 ? (viewedCount / totalCount) * 100 : 0}
					className="h-2 flex-1"
				/>
				<span className="shrink-0 text-muted-foreground text-xs">
					{viewedCount}/{totalCount}
				</span>
			</div>
			<div className="space-y-4">
				{chapters.map((c) => {
					const externalId = c.externalId;
					const isViewed = view.isChapterViewed(externalId);
					return (
						<ChapterEntry
							key={c.id}
							chapter={c}
							isViewed={isViewed}
							filePaths={filePathsByChapter.get(c.id) ?? []}
							isFilesOpen={openFiles.has(c.id)}
							runId={runId}
							lineCounts={chapterLineCountsMap.get(c.id)}
							onToggleViewed={() =>
								isViewed ? view.unmarkChapterViewed(externalId) : view.markChapterViewed(externalId)
							}
							onToggleFiles={() => toggleFiles(c.id)}
							onToggleAllFiles={() => toggleAllFiles(c.id)}
						/>
					);
				})}
			</div>
		</div>
	);
}

interface ChaptersIndexPageProps {
	chapters: Chapter[] | undefined;
	runId: string;
	viewedCount: number;
	isLoading: boolean;
}

export function ChaptersIndexPage({
	chapters,
	runId,
	viewedCount,
	isLoading,
}: ChaptersIndexPageProps) {
	if (isLoading || !chapters) return <ChapterLoadingSkeleton />;
	return <ChaptersList chapters={chapters} runId={runId} viewedCount={viewedCount} />;
}
