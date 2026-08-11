import type { Chapter } from "@stagereview/types/chapters";
import { Link, useNavigate } from "@tanstack/react-router";
import {
	Check,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Circle,
	CircleCheck,
	MessageSquare,
} from "lucide-react";
import { ShortcutTooltip } from "@/components/shared/shortcut-tooltip";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Markdown } from "@/components/ui/markdown";
import { useChapterContext } from "@/lib/chapter-context";
import { SHORTCUT_KEY } from "@/lib/keyboard-shortcuts";
import { cn } from "@/lib/utils";
import { ChapterActionsMenu } from "./chapter-actions-menu";
import { RiskBadge } from "./risk-badge";

interface ChapterNavigatorProps {
	chapter: Chapter;
	chapterIndex: number;
	viewedChapterIds: ReadonlySet<string>;
	chapterCommentCounts: ReadonlyMap<string, number>;
	onToggleViewed: (externalId: string) => void;
	onCopyChapter: () => void;
}

export function ChapterNavigator({
	chapter,
	chapterIndex,
	viewedChapterIds,
	chapterCommentCounts,
	onToggleViewed,
	onCopyChapter,
}: ChapterNavigatorProps) {
	const { runId, chapters: allChapters, chapterLineCountsMap } = useChapterContext();
	const navigate = useNavigate();
	// Dropdown items navigate via onClick — rendering a Link here
	// would nest the Markdown title's anchors inside another anchor.
	const navigateToChapter = (chapterNumber: number) => {
		void navigate({
			to: "/runs/$runId/chapters/$chapterNumber",
			params: { runId, chapterNumber: String(chapterNumber) },
			resetScroll: false,
		});
	};
	const isViewed = viewedChapterIds.has(chapter.externalId);
	const canPrev = chapterIndex > 0;
	const canNext = chapterIndex < allChapters.length - 1;
	const prevChapter = canPrev ? allChapters[chapterIndex - 1] : null;
	const nextChapter = canNext ? allChapters[chapterIndex + 1] : null;

	return (
		<div className="pl-[var(--panel-pl,2rem)] pr-[var(--panel-pr,1rem)] py-3">
			<div className="flex items-center gap-1">
				<ShortcutTooltip
					shortcutKey={SHORTCUT_KEY.MARK_CHAPTER_AS_VIEWED}
					label={isViewed ? "Unmark as viewed" : "Mark as viewed"}
				>
					<Button
						variant="ghost"
						size="icon"
						className={cn(
							"-ml-1.5 size-7 shrink-0 cursor-pointer",
							isViewed
								? "text-green-600 hover:text-green-700 dark:text-green-500 dark:hover:text-green-400"
								: "text-muted-foreground hover:text-foreground",
						)}
						onClick={() => onToggleViewed(chapter.externalId)}
					>
						{isViewed ? <CircleCheck className="size-4" /> : <Circle className="size-4" />}
					</Button>
				</ShortcutTooltip>

				{prevChapter ? (
					<ShortcutTooltip shortcutKey={SHORTCUT_KEY.PREV_CHAPTER} label="Previous chapter">
						<Link
							to="/runs/$runId/chapters/$chapterNumber"
							params={{ runId, chapterNumber: String(prevChapter.order + 1) }}
							resetScroll={false}
							className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						>
							<ChevronLeft className="size-4" />
						</Link>
					</ShortcutTooltip>
				) : (
					<span className="invisible inline-flex size-7" aria-hidden="true" />
				)}

				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							className="h-7 min-w-0 flex-1 cursor-pointer gap-1 px-2 font-medium text-sm"
						>
							<span className="truncate">Chapter {chapter.order + 1}</span>
							<ChevronDown className="size-3.5 shrink-0 opacity-50" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="center"
						className="scrollbar-thin max-h-[60vh] w-[var(--radix-dropdown-menu-trigger-width)] min-w-72 overflow-y-auto"
					>
						{allChapters.map((ch, index) => {
							const isActive = index === chapterIndex;
							const isChViewed = viewedChapterIds.has(ch.externalId);
							const counts = chapterLineCountsMap.get(ch.id);
							const commentCount = chapterCommentCounts.get(ch.id) ?? 0;
							return (
								<DropdownMenuItem
									key={ch.id}
									onClick={() => navigateToChapter(ch.order + 1)}
									className={cn("cursor-pointer gap-3 px-3 py-2.5", isActive && "bg-accent")}
								>
									<StatusBadge
										size="sm"
										badge={
											isChViewed ? (
												<Check className="size-2 text-green-600" strokeWidth={3} />
											) : undefined
										}
									>
										<div
											className={cn(
												"flex size-6 shrink-0 items-center justify-center rounded-full font-bold text-[0.625rem]",
												isActive
													? "bg-primary text-primary-foreground"
													: "bg-muted text-muted-foreground",
											)}
										>
											{ch.order + 1}
										</div>
									</StatusBadge>
									<div className="min-w-0 flex-1 space-y-0.5">
										<Markdown
											content={ch.title}
											inheritSize
											className="block truncate text-sm [&_.md-p]:my-0 [&_.md-p]:inline"
										/>
										<span className="flex items-center gap-1.5 font-medium text-[0.6875rem] opacity-70">
											{ch.riskLevel !== null && <RiskBadge level={ch.riskLevel} />}
											{counts && counts.linesAdded > 0 && (
												<span className="text-green-600 dark:text-green-500">
													+{counts.linesAdded}
												</span>
											)}
											{counts && counts.linesDeleted > 0 && (
												<span className="text-red-600 dark:text-red-500">
													-{counts.linesDeleted}
												</span>
											)}
											{commentCount > 0 && (
												<span className="ml-auto flex items-center gap-0.5 text-muted-foreground">
													<MessageSquare className="size-2.5" />
													{commentCount}
												</span>
											)}
										</span>
									</div>
								</DropdownMenuItem>
							);
						})}
					</DropdownMenuContent>
				</DropdownMenu>

				{nextChapter ? (
					<ShortcutTooltip shortcutKey={SHORTCUT_KEY.NEXT_CHAPTER} label="Next chapter">
						<Link
							to="/runs/$runId/chapters/$chapterNumber"
							params={{ runId, chapterNumber: String(nextChapter.order + 1) }}
							resetScroll={false}
							className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						>
							<ChevronRight className="size-4" />
						</Link>
					</ShortcutTooltip>
				) : (
					<span className="invisible inline-flex size-7" aria-hidden="true" />
				)}

				<ChapterActionsMenu onCopyChapter={onCopyChapter} />
			</div>
		</div>
	);
}
