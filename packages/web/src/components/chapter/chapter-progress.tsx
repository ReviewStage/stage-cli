import { Check, Circle, CircleDot } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
	buildChapterProgress,
	CHAPTER_PROGRESS_LABELS,
	CHAPTER_PROGRESS_MODE,
	CHAPTER_PROGRESS_STATUS,
	type ChapterProgressStatus,
	type ChapterProgressViewState,
	type ProgressChapter,
} from "@/lib/chapter-progress";
import { useChapterSettings } from "@/lib/use-chapter-settings";
import { cn } from "@/lib/utils";

const STATUS_STYLES = {
	[CHAPTER_PROGRESS_STATUS.NOT_STARTED]: { bar: "bg-muted", icon: Circle },
	[CHAPTER_PROGRESS_STATUS.VISITED]: { bar: "bg-muted-foreground/50", icon: CircleDot },
	[CHAPTER_PROGRESS_STATUS.REVIEWED]: { bar: "bg-green-600 dark:bg-green-500", icon: Check },
} as const satisfies Record<ChapterProgressStatus, { bar: string; icon: typeof Circle }>;

interface ChapterProgressProps {
	chapters: readonly ProgressChapter[];
	viewState: ChapterProgressViewState;
	activeChapterNumber: number | null;
	onNavigateToChapter: (chapterNumber: number) => void;
	isLoading: boolean;
	error: unknown;
}

export function ChapterProgress({
	chapters,
	viewState,
	activeChapterNumber,
	onNavigateToChapter,
	isLoading,
	error,
}: ChapterProgressProps) {
	const { chapterProgressMode } = useChapterSettings();
	if (chapterProgressMode === CHAPTER_PROGRESS_MODE.HIDDEN) return null;
	const { items, reviewedCount } = buildChapterProgress(chapters, viewState);
	if (items.length === 0) return null;
	const activeItem = items.find(({ chapter }) => chapter.order + 1 === activeChapterNumber);
	const withTitles = chapterProgressMode === CHAPTER_PROGRESS_MODE.WITH_TITLES;

	return (
		<section aria-label="Chapter progress" className="w-full min-w-0 py-2">
			<div className="mb-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
				<span aria-live="polite" aria-atomic="true" className="tabular-nums">
					{error
						? "Review progress unavailable"
						: isLoading
							? "Loading review progress…"
							: `Reviewed ${reviewedCount} of ${items.length}`}
				</span>
				{activeItem && (
					<span className="text-muted-foreground tabular-nums">
						Chapter {activeItem.chapter.order + 1} of {items.length}
					</span>
				)}
			</div>
			<nav aria-label="Chapter navigation" className="flex flex-wrap gap-x-2 gap-y-1">
				{items.map(({ chapter, status }) => {
					const chapterNumber = chapter.order + 1;
					const isActive = chapterNumber === activeChapterNumber;
					const { bar, icon: StatusIcon } = STATUS_STYLES[status];
					const statusLabel =
						error || isLoading ? "Review status unavailable" : CHAPTER_PROGRESS_LABELS[status];
					return (
						<Tooltip key={chapter.id} delayDuration={200}>
							<TooltipTrigger asChild>
								<button
									type="button"
									onClick={() => onNavigateToChapter(chapterNumber)}
									aria-current={isActive ? "step" : undefined}
									aria-label={`Chapter ${chapterNumber}: ${chapter.title}. ${statusLabel}`}
									className="group/progress min-w-10 max-w-full flex-1 basis-0 cursor-pointer rounded-sm py-2 text-left outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring [@media(pointer:coarse)]:min-h-11"
								>
									<span
										aria-hidden="true"
										className={cn(
											"mb-1.5 block h-1.5 rounded-full transition-opacity group-hover/progress:opacity-80",
											bar,
										)}
									/>
									<span className="flex items-center gap-1 text-xs">
										<StatusIcon aria-hidden="true" className="size-3 shrink-0" />
										<span className="tabular-nums">{chapterNumber}</span>
										{isActive && (
											<span
												aria-hidden="true"
												className="size-1.5 shrink-0 rounded-full bg-primary"
											/>
										)}
										{withTitles && (
											<span className="hidden truncate text-muted-foreground sm:inline">
												{chapter.title}
											</span>
										)}
									</span>
								</button>
							</TooltipTrigger>
							<TooltipContent className="max-w-xs">
								<p className="font-medium">{chapter.title}</p>
								<p className="mt-1 text-muted-foreground">
									Chapter {chapterNumber} · {statusLabel}
									{isActive && " · Current"}
								</p>
							</TooltipContent>
						</Tooltip>
					);
				})}
			</nav>
		</section>
	);
}
