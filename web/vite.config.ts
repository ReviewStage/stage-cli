import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	root: path.resolve(__dirname),
	// `tsconfigPaths` reads the `paths` block in web/tsconfig.json so vite,
	// vitest, and tsc all resolve aliases from one source of truth.
	plugins: [tsconfigPaths(), react(), tailwindcss()],
	build: {
		outDir: path.resolve(__dirname, "../web-dist"),
		emptyOutDir: true,
	},
});
