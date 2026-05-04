import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { FilesPage } from "@/routes/files-page";

const filesSearchSchema = z.object({
	scrollTo: z.string().optional(),
});

export const Route = createFileRoute("/runs/$runId/files")({
	validateSearch: (search) => filesSearchSchema.parse(search),
	component: FilesRoute,
});

function FilesRoute() {
	const { runId } = Route.useParams();
	const { scrollTo } = Route.useSearch();
	return <FilesPage runId={runId} scrollTo={scrollTo} />;
}
