import { createFileRoute } from "@tanstack/react-router";
import { parseChapterNumber } from "@/lib/chapter-number";
import { ChapterDetailPage } from "@/routes/chapter-detail-page";

export const Route = createFileRoute("/runs/$runId/chapters/$chapterNumber")({
	component: ChapterRoute,
});

function ChapterRoute() {
	const { runId, chapterNumber } = Route.useParams();
	return <ChapterDetailPage runId={runId} chapterNumber={parseChapterNumber(chapterNumber)} />;
}
