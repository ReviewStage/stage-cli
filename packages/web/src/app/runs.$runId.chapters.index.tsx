import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useChapterViewState } from "@/lib/chapter-view-state-context";

export const Route = createFileRoute("/runs/$runId/chapters/")({
	component: ChaptersIndexRedirect,
});

// The chapter view mode lives in localStorage, so only the client can decide
// what the bare /chapters URL means. In continuous mode the chapters layout
// renders the continuous view without an Outlet, so this component never
// mounts; in paged mode it resumes the continuous reader's active chapter,
// or bounces to the run overview for a fresh link. A
// beforeLoad redirect here would run on every navigation regardless of view
// mode and make /chapters unreachable for continuous mode.
function ChaptersIndexRedirect() {
	const { runId } = Route.useParams();
	const activeChapterNumber = useChapterViewState()?.activeContinuousChapterNumber;
	if (activeChapterNumber !== undefined && activeChapterNumber !== null) {
		return (
			<Navigate
				to="/runs/$runId/chapters/$chapterNumber"
				params={{ runId, chapterNumber: String(activeChapterNumber) }}
				replace
				resetScroll={false}
			/>
		);
	}
	return <Navigate to="/runs/$runId" params={{ runId }} replace />;
}
