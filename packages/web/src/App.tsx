import { Topbar } from "@/components/layout/topbar";
import { useHashRunId } from "@/lib/use-hash-run-id";
import { PullRequestLayout } from "@/routes/pull-request-layout";

function NoRunSelected() {
	return (
		<div className="flex flex-1 items-center justify-center p-6">
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
	return (
		<div className="flex min-h-screen flex-col bg-background text-foreground">
			<Topbar runId={runId} />
			{runId ? <PullRequestLayout runId={runId} /> : <NoRunSelected />}
		</div>
	);
}
