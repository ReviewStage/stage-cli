import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useChapters } from "@/lib/use-chapters";
import { useViewStateData } from "@/lib/use-view-state";
import { ChaptersIndexPage } from "@/routes/chapters-index-page";

export const Route = createFileRoute("/runs/$runId/")({
	component: ChaptersRoute,
});

function ChaptersRoute() {
	const { runId } = Route.useParams();
	const { data, isLoading } = useChapters(runId);
	const { chapterIdSet } = useViewStateData(runId);
	const chapters = data?.chapters;
	const viewedCount = useMemo(() => {
		if (!chapters) return 0;
		let n = 0;
		for (const chapter of chapters) if (chapterIdSet.has(chapter.externalId)) n++;
		return n;
	}, [chapters, chapterIdSet]);

	return (
		<ChaptersIndexPage
			chapters={chapters}
			runId={runId}
			viewedCount={viewedCount}
			isLoading={isLoading}
		/>
	);
}
