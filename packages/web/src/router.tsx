import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			// Two browser tabs on the same run see synchronized state via refetch on focus
			// (acceptance criterion). 30s staleTime keeps a single tab from re-fetching too eagerly.
			staleTime: 30_000,
			refetchOnWindowFocus: true,
		},
	},
});

export const router = createRouter({
	routeTree,
	context: {
		queryClient,
	},
	scrollRestoration: true,
	defaultPreload: "intent",
	defaultPreloadStaleTime: 0,
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
