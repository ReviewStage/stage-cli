import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	root: path.resolve(__dirname),
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
			// Shared wire-format Zod schemas. Mirrors hosted's `@stage/types`
			// package import shape so future code-sharing keeps the import sites
			// identical across products.
			"@stage/types": path.resolve(__dirname, "..", "src", "types"),
		},
	},
	build: {
		outDir: path.resolve(__dirname, "../web-dist"),
		emptyOutDir: true,
	},
});
