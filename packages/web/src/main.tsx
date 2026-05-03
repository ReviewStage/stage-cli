import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "./lib/theme";
import { DiffSettingsProvider } from "./lib/use-diff-settings";
import { queryClient, router } from "./router";
import "./styles/globals.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
	throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
	<StrictMode>
		<ThemeProvider>
			<QueryClientProvider client={queryClient}>
				<DiffSettingsProvider>
					<RouterProvider router={router} />
				</DiffSettingsProvider>
			</QueryClientProvider>
		</ThemeProvider>
	</StrictMode>,
);
