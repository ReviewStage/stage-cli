import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet, redirect } from "@tanstack/react-router";

export const Route = createRootRouteWithContext<{
	queryClient: QueryClient;
}>()({
	beforeLoad: ({ location }) => {
		// TanStack Router strips the leading `#` from `location.hash`, so a legacy
		// URL like `/#/runs/abc` lands here with `hash === "/runs/abc"`.
		if (location.hash.startsWith("/runs/")) {
			throw redirect({
				to: location.hash,
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
