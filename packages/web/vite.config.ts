import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	root: path.resolve(__dirname),
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
		},
	},
	plugins: [
		tanstackRouter({
			routesDirectory: "./src/app",
			quoteStyle: "double",
			semicolons: true,
			routeFileIgnorePattern: "__tests__",
		}),
		react(),
		tailwindcss(),
	],
	build: {
		outDir: path.resolve(__dirname, "../cli/web-dist"),
		emptyOutDir: true,
	},
});
