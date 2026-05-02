import { useSyncExternalStore } from "react";

// Parses `#/runs/{runId}` from the URL hash. The CLI's `show` command opens
// the SPA at exactly this URL shape (see src/show.ts). Hash routing is the
// stage-cli analog of TanStack Router's `Route.useParams()`.
//
// Anything after the runId segment is ignored: a future `#/runs/abc/chapters/3`
// route would still resolve runId to `"abc"` here, leaving the rest for a
// dedicated nested-route hook to parse.
function readRunIdFromHash(): string | null {
	const match = window.location.hash.match(/^#\/runs\/([^/?#]+)/);
	return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function subscribe(callback: () => void): () => void {
	window.addEventListener("hashchange", callback);
	return () => window.removeEventListener("hashchange", callback);
}

export function useHashRunId(): string | null {
	return useSyncExternalStore(subscribe, readRunIdFromHash);
}
