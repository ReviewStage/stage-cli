import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	platform: "node",
	target: "node20",
	outDir: "dist",
	clean: true,
	dts: false,
	shims: true,
	outExtensions: () => ({ js: ".js" }),
	// Inline workspace deps — they won't exist in the published package's
	// node_modules, so the bundle has to carry their source.
	deps: { alwaysBundle: [/^@stage-cli\//] },
});
