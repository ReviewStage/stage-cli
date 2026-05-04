import { createFileRoute } from "@tanstack/react-router";
import { Topbar } from "@/components/layout/topbar";

export const Route = createFileRoute("/")({
	component: NoRunSelected,
});

function NoRunSelected() {
	return (
		<>
			<Topbar runId={null} />
			<div className="flex flex-1 items-center justify-center p-6">
				<div className="max-w-md text-center">
					<h1 className="font-semibold text-lg">No run selected</h1>
					<p className="mt-2 text-muted-foreground text-sm">
						The URL is missing a <code>/runs/&lt;runId&gt;</code> path. Open the app via{" "}
						<code>stage-cli show &lt;path&gt;</code>.
					</p>
				</div>
			</div>
		</>
	);
}
