import { useHashRunId } from "@/lib/use-hash-run-id";
import { PullRequestLayout } from "@/routes/pull-request-layout";

function NoRunSelected() {
	return (
		<div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
			<div className="max-w-md text-center">
				<h1 className="font-semibold text-lg">No run selected</h1>
				<p className="mt-2 text-muted-foreground text-sm">
					The URL is missing a <code>#/runs/&lt;runId&gt;</code> hash. Open the app via{" "}
					<code>stage-cli show &lt;path&gt;</code>.
				</p>
			</div>
		</div>
	);
}

export function App() {
	const runId = useHashRunId();
	if (!runId) return <NoRunSelected />;
	return <PullRequestLayout runId={runId} />;
}
