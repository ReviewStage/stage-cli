import type { default as MermaidAPI } from "mermaid";
import { APP_THEME, type AppTheme } from "@/lib/theme";

let loadPromise: Promise<typeof MermaidAPI> | null = null;
let currentTheme: AppTheme | null = null;

let renderCounter = 0;

// Quote unquoted [label] nodes containing mermaid-special characters (@ # < >)
// while preserving multi-bracket shapes like [[subroutine]], [(cylinder)], [/parallelogram/].
function sanitizeMermaidSource(source: string): string {
	return source.replace(/(?<!\[)\[(?![[(/\\])([^[\]"]*[@#<>][^[\]"]*)\](?!\])/g, '["$1"]');
}

async function getMermaidInstance(theme: AppTheme): Promise<typeof MermaidAPI> {
	if (!loadPromise) {
		loadPromise = import("mermaid").then((mod) => mod.default);
	}

	const instance = await loadPromise;

	if (currentTheme !== theme) {
		currentTheme = theme;
		instance.initialize({
			startOnLoad: false,
			suppressErrorRendering: true,
			theme: theme === APP_THEME.DARK ? "dark" : "default",
		});
	}

	return instance;
}

export async function renderMermaidDiagram(
	source: string,
	theme: AppTheme,
): Promise<{ svg: string }> {
	const instance = await getMermaidInstance(theme);
	const id = `mermaid-diagram-${++renderCounter}`;
	return instance.render(id, sanitizeMermaidSource(source));
}
