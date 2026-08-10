import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/runs/$runId/chapters/")({
	component: ChaptersIndexRedirect,
});

// The chapter view mode lives in localStorage, so only the client can decide
// what the bare /chapters URL means. In continuous mode the chapters layout
// renders the continuous view without an Outlet, so this component never
// mounts; in paged mode it mounts and bounces to the run overview. A
// beforeLoad redirect here would run on every navigation regardless of view
// mode and make /chapters unreachable for continuous mode.
function ChaptersIndexRedirect() {
	const { runId } = Route.useParams();
	return <Navigate to="/runs/$runId" params={{ runId }} replace />;
}
