import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		// `@/*` is the SPA-local alias declared in packages/web/tsconfig.json.
		// Mirroring it here lets vitest resolve web tests without dragging in
		// vite-tsconfig-paths just for one alias.
		alias: {
			"@": path.resolve(__dirname, "packages/web/src"),
		},
	},
});
