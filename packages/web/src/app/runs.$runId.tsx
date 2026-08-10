import { createFileRoute } from "@tanstack/react-router";
import { Topbar } from "@/components/layout/topbar";
import { CommentDraftStoreProvider } from "@/lib/comment-draft-store";
import { FileExpansionProvider } from "@/lib/file-expansion-context";
import { ReviewProvider } from "@/lib/review-context";
import { PullRequestLayout } from "@/routes/pull-request-layout";

export const Route = createFileRoute("/runs/$runId")({
	component: RunLayout,
});

function RunLayout() {
	const { runId } = Route.useParams();
	return (
		<ReviewProvider runId={runId}>
			{/* Per-file expansion and comment-draft state live at the run level so
			    they survive virtualized rows unmounting and tab switches. */}
			<FileExpansionProvider resetKey={runId}>
				<CommentDraftStoreProvider resetKey={runId}>
					<Topbar />
					<PullRequestLayout runId={runId} />
				</CommentDraftStoreProvider>
			</FileExpansionProvider>
		</ReviewProvider>
	);
}
