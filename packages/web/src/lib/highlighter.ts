import type { Highlighter } from "shiki";
import { createHighlighter } from "shiki";

const PRELOADED_LANGS = [
	"bash",
	"c",
	"cpp",
	"csharp",
	"css",
	"diff",
	"dockerfile",
	"go",
	"graphql",
	"html",
	"java",
	"javascript",
	"json",
	"jsx",
	"kotlin",
	"markdown",
	"php",
	"python",
	"ruby",
	"rust",
	"scss",
	"shell",
	"sql",
	"swift",
	"toml",
	"tsx",
	"typescript",
	"xml",
	"yaml",
] as const;

export const SHIKI_THEMES = {
	light: "github-light",
	dark: "github-dark",
} as const;

let highlighterPromise: Promise<Highlighter> | null = null;

export function getHighlighter() {
	if (!highlighterPromise) {
		highlighterPromise = createHighlighter({
			themes: [SHIKI_THEMES.light, SHIKI_THEMES.dark],
			langs: [...PRELOADED_LANGS],
		});
	}
	return highlighterPromise;
}
