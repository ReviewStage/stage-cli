import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";

export const Route = createRootRouteWithContext<{
	queryClient: QueryClient;
}>()({
	component: RootLayout,
});

function RootLayout() {
	return (
		<div className="flex min-h-screen flex-col bg-background text-foreground">
			<Outlet />
		</div>
	);
}
