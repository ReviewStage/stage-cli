import type { Chapter } from "@stagereview/types/chapters";
import { MessageSquare } from "lucide-react";
import { Markdown } from "@/components/ui/markdown";
import type { LineCounts } from "@/lib/remaining-line-counts";
import { RiskChip } from "./risk-badge";

interface ChapterTitleBlockProps {
	chapter: Chapter;
	counts: LineCounts | null;
	commentCount: number;
}

export function ChapterTitleBlock({ chapter, counts, commentCount }: ChapterTitleBlockProps) {
	return (
		<>
			<Markdown
				content={chapter.title}
				inheritSize
				className="pb-2 pl-[var(--panel-pl,2rem)] pr-[var(--panel-pr,1rem)] font-semibold text-base leading-snug [&_.md-p]:my-0"
			/>
			{(chapter.riskLevel !== null ||
				(counts && (counts.linesAdded > 0 || counts.linesDeleted > 0)) ||
				commentCount > 0) && (
				<div className="flex items-center gap-3 pb-3 pl-[var(--panel-pl,2rem)] pr-[var(--panel-pr,1rem)] text-xs">
					{chapter.riskLevel !== null && (
						<RiskChip level={chapter.riskLevel} reasons={chapter.riskReasons} />
					)}
					<div className="ml-auto flex items-center gap-3">
						{counts !== null && counts.linesAdded > 0 && (
							<span className="font-medium text-green-600 dark:text-green-500">
								+{counts.linesAdded}
							</span>
						)}
						{counts !== null && counts.linesDeleted > 0 && (
							<span className="font-medium text-red-600 dark:text-red-500">
								-{counts.linesDeleted}
							</span>
						)}
						{commentCount > 0 && (
							<span className="flex items-center gap-1 text-muted-foreground">
								<MessageSquare className="size-3" />
								{commentCount}
							</span>
						)}
					</div>
				</div>
			)}
		</>
	);
}
