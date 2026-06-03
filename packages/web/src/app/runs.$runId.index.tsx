import { createFileRoute } from "@tanstack/react-router";
import { OverviewSidebar } from "@/components/pull-request/overview-sidebar";
import { useChapters } from "@/lib/use-chapters";
import { usePullRequest } from "@/lib/use-pull-request";
import { ChaptersIndexPage } from "@/routes/chapters-index-page";

export const Route = createFileRoute("/runs/$runId/")({
	component: ChaptersRoute,
});

// Both columns pin below the sticky tab bar and scroll independently. The
// `--content-top`/`--main-height` vars are set by the pull-request layout.
const COLUMN_CLASS =
	"scrollbar-thin min-w-0 @4xl:sticky @4xl:top-[var(--content-top)] @4xl:max-h-[calc(var(--main-height)_-_var(--content-top))] @4xl:overflow-y-auto @4xl:pb-6";

function ChaptersRoute() {
	const { runId } = Route.useParams();
	const { data, isLoading } = useChapters(runId);
	const { data: prData } = usePullRequest(runId);

	const chapters = data?.chapters;
	const prologue = data?.prologue ?? null;
	const pullRequest = prData?.pullRequest ?? null;

	const hasPrologue = prologue !== null;
	const hasDescription = Boolean(pullRequest?.user && pullRequest.body.trim().length > 0);

	// Without prologue or PR description there's nothing for the left column —
	// the chapters list spans the full width.
	if (!hasPrologue && !hasDescription) {
		return <ChaptersIndexPage chapters={chapters} runId={runId} isLoading={isLoading} />;
	}

	return (
		<div className="@container h-full">
			<div className="grid h-full grid-cols-1 gap-6 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
				<div className={COLUMN_CLASS}>
					<OverviewSidebar prologue={prologue} pullRequest={pullRequest} />
				</div>
				<div className={COLUMN_CLASS}>
					<ChaptersIndexPage chapters={chapters} runId={runId} isLoading={isLoading} />
				</div>
			</div>
		</div>
	);
}
