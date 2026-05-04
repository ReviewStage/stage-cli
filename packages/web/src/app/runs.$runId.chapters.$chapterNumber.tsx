import { createFileRoute } from "@tanstack/react-router";
import { ChapterDetailPage } from "@/routes/chapter-detail-page";

export const Route = createFileRoute("/runs/$runId/chapters/$chapterNumber")({
	component: ChapterRoute,
});

function ChapterRoute() {
	const { runId, chapterNumber } = Route.useParams();
	const parsed = Number.parseInt(chapterNumber, 10);
	const valid = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
	return <ChapterDetailPage runId={runId} chapterNumber={valid} />;
}
