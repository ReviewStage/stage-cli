import type { Chapter } from "@stage-cli/types/chapters";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronLeft, ChevronRight, Circle, CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ChapterNavigatorProps {
	runId: string;
	chapter: Chapter;
	chapterIndex: number;
	allChapters: Chapter[];
	viewedChapterIds: ReadonlySet<string>;
	onToggleViewed: (externalId: string) => void;
}

export function ChapterNavigator({
	runId,
	chapter,
	chapterIndex,
	allChapters,
	viewedChapterIds,
	onToggleViewed,
}: ChapterNavigatorProps) {
	const isViewed = viewedChapterIds.has(chapter.externalId);
	const canPrev = chapterIndex > 0;
	const canNext = chapterIndex < allChapters.length - 1;
	const prevChapter = canPrev ? allChapters[chapterIndex - 1] : null;
	const nextChapter = canNext ? allChapters[chapterIndex + 1] : null;

	return (
		<div className="px-4 py-3">
			<div className="flex items-center gap-1">
				<Tooltip>
					<TooltipTrigger asChild>
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
							aria-label={isViewed ? "Unmark as viewed" : "Mark as viewed"}
						>
							{isViewed ? <CircleCheck className="size-4" /> : <Circle className="size-4" />}
						</Button>
					</TooltipTrigger>
					<TooltipContent>{isViewed ? "Unmark as viewed" : "Mark as viewed"}</TooltipContent>
				</Tooltip>

				<Tooltip>
					<TooltipTrigger asChild>
						{prevChapter ? (
							<Link
								to="/runs/$runId/chapters/$chapterNumber"
								params={{ runId, chapterNumber: String(prevChapter.order) }}
								className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
								aria-label="Previous chapter"
							>
								<ChevronLeft className="size-4" />
							</Link>
						) : (
							<span className="invisible inline-flex size-7" aria-hidden="true" />
						)}
					</TooltipTrigger>
					<TooltipContent>Previous chapter</TooltipContent>
				</Tooltip>

				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							className="h-7 min-w-0 flex-1 cursor-pointer gap-1 px-2 font-medium text-sm"
						>
							<span className="truncate">Chapter {chapterIndex + 1}</span>
							<ChevronDown className="size-3.5 shrink-0 opacity-50" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="center"
						className="max-h-[60vh] w-[var(--radix-dropdown-menu-trigger-width)] min-w-72 overflow-y-auto"
					>
						{allChapters.map((ch, index) => {
							const isActive = index === chapterIndex;
							const isChViewed = viewedChapterIds.has(ch.externalId);
							return (
								<DropdownMenuItem key={ch.id} asChild className="gap-3 px-3 py-2.5">
									<Link
										to="/runs/$runId/chapters/$chapterNumber"
										params={{ runId, chapterNumber: String(ch.order) }}
										className={cn("cursor-pointer", isActive && "bg-accent")}
									>
										<div
											className={cn(
												"flex size-6 shrink-0 items-center justify-center rounded-full font-bold text-[10px]",
												isActive
													? "bg-primary text-primary-foreground"
													: "bg-muted text-muted-foreground",
											)}
										>
											{index + 1}
										</div>
										<span className="min-w-0 flex-1 truncate text-sm">{ch.title}</span>
										{isChViewed && (
											<CircleCheck
												className="size-3.5 shrink-0 text-green-600 dark:text-green-500"
												aria-hidden="true"
											/>
										)}
									</Link>
								</DropdownMenuItem>
							);
						})}
					</DropdownMenuContent>
				</DropdownMenu>

				<Tooltip>
					<TooltipTrigger asChild>
						{nextChapter ? (
							<Link
								to="/runs/$runId/chapters/$chapterNumber"
								params={{ runId, chapterNumber: String(nextChapter.order) }}
								className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
								aria-label="Next chapter"
							>
								<ChevronRight className="size-4" />
							</Link>
						) : (
							<span className="invisible inline-flex size-7" aria-hidden="true" />
						)}
					</TooltipTrigger>
					<TooltipContent>Next chapter</TooltipContent>
				</Tooltip>
			</div>
		</div>
	);
}
