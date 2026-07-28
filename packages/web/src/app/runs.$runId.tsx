import { createFileRoute } from "@tanstack/react-router";
import { Topbar } from "@/components/layout/topbar";
import { CommentThreadsProvider } from "@/lib/comment-threads-context";
import { PullRequestLayout } from "@/routes/pull-request-layout";

export const Route = createFileRoute("/runs/$runId")({
	component: RunLayout,
});

function RunLayout() {
	const { runId } = Route.useParams();
	return (
		<CommentThreadsProvider runId={runId}>
			<Topbar />
			<PullRequestLayout runId={runId} />
		</CommentThreadsProvider>
	);
}
