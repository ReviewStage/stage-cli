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

	return (
		<>
			<PrologueSection prologue={data?.prologue} />
			<ChaptersIndexPage
				chapters={chapters}
				runId={runId}
				viewedCount={viewedCount}
				isLoading={isLoading}
			/>
		</>
	);
}
