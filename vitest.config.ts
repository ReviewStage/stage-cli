import path from "node:path";
import { fileURLToPath } from "node:url";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	// SPA modules under test resolve `@/*` and `@cli/types/*` from web/tsconfig.json.
	// CLI tests don't use either alias, so pointing the plugin at web/'s tsconfig
	// covers the only consumer.
	plugins: [tsconfigPaths({ projects: [path.resolve(__dirname, "web", "tsconfig.json")] })],
});
