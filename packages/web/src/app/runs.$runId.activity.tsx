import { createFileRoute } from "@tanstack/react-router";
import { ActivityPage } from "@/routes/activity-page";

export const Route = createFileRoute("/runs/$runId/activity")({
	component: ActivityRoute,
});

function ActivityRoute() {
	const { runId } = Route.useParams();
	return <ActivityPage runId={runId} />;
}
