import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			// Mirrors web/vite.config.ts. The CLI tests don't use these aliases, but
			// SPA modules under test (e.g. web/src/lib/use-view-state.ts) do, so the
			// resolver needs them to find the imports.
			"@": path.resolve(__dirname, "web", "src"),
			"@stage/types": path.resolve(__dirname, "src", "types"),
		},
	},
});
