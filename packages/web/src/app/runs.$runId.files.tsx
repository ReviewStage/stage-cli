import { createFileRoute } from "@tanstack/react-router";
import { FilesPage } from "@/routes/files-page";

export const Route = createFileRoute("/runs/$runId/files")({
	component: FilesRoute,
});

function FilesRoute() {
	const { runId } = Route.useParams();
	return <FilesPage runId={runId} />;
}
