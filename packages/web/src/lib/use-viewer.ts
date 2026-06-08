import { type Viewer, ViewerSchema } from "@stagereview/types/viewer";
import { useQuery } from "@tanstack/react-query";
import { jsonFetch } from "./use-view-state";

const FALLBACK_VIEWER: Viewer = { name: "You", avatarUrl: null };

async function fetchViewer(): Promise<Viewer> {
	const raw = await jsonFetch<unknown>("/api/viewer");
	return ViewerSchema.parse(raw);
}

/**
 * The local reviewer's display identity (resolved server-side from gh/git). The
 * identity is stable for the session, so it's cached indefinitely; while it loads
 * or if it fails, callers get a generic "You".
 */
export function useViewer(): Viewer {
	const { data } = useQuery<Viewer>({
		queryKey: ["viewer"],
		queryFn: fetchViewer,
		staleTime: Number.POSITIVE_INFINITY,
	});
	return data ?? FALLBACK_VIEWER;
}
