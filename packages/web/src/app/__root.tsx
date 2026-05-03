import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet, redirect } from "@tanstack/react-router";

export const Route = createRootRouteWithContext<{
	queryClient: QueryClient;
}>()({
	beforeLoad: ({ location }) => {
		if (location.hash.startsWith("#/runs/")) {
			throw redirect({
				to: location.hash.slice(1),
				replace: true,
			});
		}
	},
	component: RootLayout,
});

function RootLayout() {
	return (
		<div className="flex min-h-screen flex-col bg-background text-foreground">
			<Outlet />
		</div>
	);
}
