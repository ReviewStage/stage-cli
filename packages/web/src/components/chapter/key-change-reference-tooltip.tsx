import type { HunkReference, LineRef } from "@stagereview/types/chapters";
import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { sortLineRefsByChapterOrder } from "@/lib/sort-line-refs";

const MAX_TOOLTIP_REFS = 4;

function getLineRangeLabel(lineRef: LineRef): string {
	if (lineRef.startLine === lineRef.endLine) return `Line ${lineRef.startLine}`;
	return `Lines ${lineRef.startLine}-${lineRef.endLine}`;
}

interface KeyChangeReferenceTooltipProps {
	lineRefs: LineRef[];
	hunkRefs: readonly HunkReference[];
	children: ReactNode;
}

export function KeyChangeReferenceTooltip({
	lineRefs,
	hunkRefs,
	children,
}: KeyChangeReferenceTooltipProps) {
	if (lineRefs.length === 0) return <>{children}</>;

	// Sort refs into chapter order so the visible/truncated set matches the
	// range the focus action will actually scroll to; otherwise hover advertises
	// a different first reference than the click focuses.
	const orderedRefs = sortLineRefsByChapterOrder(lineRefs, hunkRefs);
	const visibleRefs = orderedRefs.slice(0, MAX_TOOLTIP_REFS);
	const hiddenRefCount = orderedRefs.length - visibleRefs.length;

	return (
		<Tooltip>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent side="right" align="start" className="max-w-sm">
				<div className="space-y-2">
					{visibleRefs.map((lineRef) => (
						<div
							key={`${lineRef.filePath}-${lineRef.side}-${lineRef.startLine}-${lineRef.endLine}`}
							className="space-y-0.5"
						>
							<p className="break-all font-mono text-[11px] text-foreground">{lineRef.filePath}</p>
							<p className="font-mono text-[11px] text-muted-foreground">
								{getLineRangeLabel(lineRef)}
							</p>
						</div>
					))}
					{hiddenRefCount > 0 && (
						<p className="text-[11px] text-muted-foreground">
							+{hiddenRefCount} more reference{hiddenRefCount === 1 ? "" : "s"}
						</p>
					)}
				</div>
			</TooltipContent>
		</Tooltip>
	);
}
