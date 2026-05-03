import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ThemeProvider } from "./lib/theme";
import { DiffSettingsProvider } from "./lib/use-diff-settings";
import "./styles/globals.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
	throw new Error("Root element #root not found");
}

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			// Two browser tabs on the same run see synchronized state via refetch on focus
			// (acceptance criterion). 30s staleTime keeps a single tab from re-fetching too eagerly.
			staleTime: 30_000,
			refetchOnWindowFocus: true,
		},
	},
});

createRoot(rootElement).render(
	<StrictMode>
		<ThemeProvider>
			<QueryClientProvider client={queryClient}>
				<DiffSettingsProvider>
					<App />
				</DiffSettingsProvider>
			</QueryClientProvider>
		</ThemeProvider>
	</StrictMode>,
);
