import {
	createFileRoute,
	Navigate,
	Outlet,
	useParams,
	useRouterState,
} from "@tanstack/react-router";
import { useState } from "react";
import { CHAPTER_VIEW_MODE, useChapterSettings } from "@/lib/use-chapter-settings";
import { ContinuousChaptersPage } from "@/routes/continuous-chapters-page";

export const Route = createFileRoute("/runs/$runId/chapters")({
	component: ChaptersLayout,
});

const CHAPTER_DETAIL_ROUTE_ID = "/runs/$runId/chapters/$chapterNumber";

/**
 * Routes between the paged and continuous chapter experiences. In continuous
 * mode `/chapters/N` deep links are normalized to the bare `/chapters` URL —
 * and the redirect must happen BEFORE
 * the continuous view mounts: the pull-request layout picks page scroll vs
 * contained scroll off the matched route, so the continuous view must only
 * ever render under the bare URL's contained scroll area. The deep-linked
 * chapter number is captured here so the continuous view can still scroll to
 * it after the URL is normalized.
 */
function ChaptersLayout() {
	const { runId } = Route.useParams();
	const params = useParams({ strict: false });
	const { chapterViewMode } = useChapterSettings();
	const isOnChapterDetailRoute = useRouterState({
		select: (state) => state.matches.some((match) => match.routeId === CHAPTER_DETAIL_ROUTE_ID),
	});

	// Same integer semantics as the chapter detail route, so paged and
	// continuous deep links agree on what `/chapters/1e2` or `/chapters/1.5` mean.
	const parsed =
		params.chapterNumber === undefined ? Number.NaN : Number.parseInt(params.chapterNumber, 10);
	const deepLinkedChapterNumber = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
	const [initialChapterNumber, setInitialChapterNumber] = useState(deepLinkedChapterNumber);
	// Render-time state sync ("adjusting state during render"): remember the
	// latest deep-linked chapter so it survives the normalizing redirect below,
	// and so switching paged → continuous while on a chapter detail page opens
	// the continuous reader at that same chapter.
	if (isOnChapterDetailRoute && deepLinkedChapterNumber !== initialChapterNumber) {
		setInitialChapterNumber(deepLinkedChapterNumber);
	}
	// Stack navigation swaps runs while this layout stays mounted; a remembered
	// deep link from the previous run must not scroll the sibling's reader.
	const [stateOwner, setStateOwner] = useState(runId);
	if (stateOwner !== runId) {
		setStateOwner(runId);
		setInitialChapterNumber(isOnChapterDetailRoute ? deepLinkedChapterNumber : undefined);
	}

	if (chapterViewMode === CHAPTER_VIEW_MODE.CONTINUOUS) {
		if (isOnChapterDetailRoute) {
			return <Navigate to="/runs/$runId/chapters" params={{ runId }} replace />;
		}
		return <ContinuousChaptersPage runId={runId} initialChapterNumber={initialChapterNumber} />;
	}

	// In paged mode a bare /chapters URL always matches the index child route,
	// which redirects to the run overview — the Outlet covers both children.
	return <Outlet />;
}
