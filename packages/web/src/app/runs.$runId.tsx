import { createFileRoute } from "@tanstack/react-router";
import { Topbar } from "@/components/layout/topbar";
import { ReviewProvider } from "@/lib/review-context";
import { PullRequestLayout } from "@/routes/pull-request-layout";

export const Route = createFileRoute("/runs/$runId")({
	component: RunLayout,
});

function RunLayout() {
	const { runId } = Route.useParams();
	return (
		<ReviewProvider runId={runId}>
			<Topbar />
			<PullRequestLayout runId={runId} />
		</ReviewProvider>
	);
}
