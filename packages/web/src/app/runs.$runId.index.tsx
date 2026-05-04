import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { PrologueSection } from "@/components/prologue/prologue-section";
import { useChapters } from "@/lib/use-chapters";
import { countViewedChapters, useViewStateData } from "@/lib/use-view-state";
import { ChaptersIndexPage } from "@/routes/chapters-index-page";

export const Route = createFileRoute("/runs/$runId/")({
	component: ChaptersRoute,
});

function ChaptersRoute() {
	const { runId } = Route.useParams();
	const { data, isLoading } = useChapters(runId);
	const { chapterIdSet } = useViewStateData(runId);
	const chapters = data?.chapters;
	const viewedCount = useMemo(
		() => countViewedChapters(chapters, chapterIdSet),
		[chapters, chapterIdSet],
	);

	const prologue = data?.prologue;

	if (!prologue) {
		return (
			<ChaptersIndexPage
				chapters={chapters}
				runId={runId}
				viewedCount={viewedCount}
				isLoading={isLoading}
			/>
		);
	}

	return (
		<div className="@container">
			<div className="grid grid-cols-1 gap-6 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
				<div className="scrollbar-thin min-w-0 @4xl:sticky @4xl:top-[var(--content-top)] @4xl:max-h-[calc(var(--main-height)_-_var(--content-top))] @4xl:overflow-y-auto @4xl:pr-4 @4xl:pb-6">
					<PrologueSection prologue={prologue} runId={runId} />
				</div>
				<div className="min-w-0">
					<ChaptersIndexPage
						chapters={chapters}
						runId={runId}
						viewedCount={viewedCount}
						isLoading={isLoading}
					/>
				</div>
			</div>
		</div>
	);
}
