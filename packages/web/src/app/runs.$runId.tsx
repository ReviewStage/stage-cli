import { createFileRoute } from "@tanstack/react-router";
import { Topbar } from "@/components/layout/topbar";
import { PullRequestLayout } from "@/routes/pull-request-layout";

export const Route = createFileRoute("/runs/$runId")({
	component: RunLayout,
});

function RunLayout() {
	const { runId } = Route.useParams();
	return (
		<>
			<Topbar runId={runId} />
			<PullRequestLayout runId={runId} />
		</>
	);
}
