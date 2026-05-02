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
			// Shared wire-format Zod schemas. Both the CLI server (src/routes/*) and
			// the SPA import these so the contract has a single source of truth.
			"@wire": path.resolve(__dirname, "..", "src", "wire"),
		},
	},
	build: {
		outDir: path.resolve(__dirname, "../web-dist"),
		emptyOutDir: true,
	},
});
