import { Suspense, use } from "react";
import { pre as PreFallback } from "@/components/ui/markdown-components";
import { getHighlighter, SHIKI_THEMES } from "@/lib/highlighter";

interface CodeBlockProps {
	code: string;
	language: string;
}

// Shiki emits `--shiki-light`/`--shiki-dark` CSS variables (defaultColor: false);
// the arbitrary variants below pick the variable matching the app theme, so code
// blocks follow the light/dark toggle.
const SHIKI_THEME_CLASSES =
	"[&_.shiki]:bg-(--shiki-light-bg) [&_.shiki]:text-(--shiki-light) [&_.shiki_span]:text-(--shiki-light) dark:[&_.shiki]:bg-(--shiki-dark-bg) dark:[&_.shiki]:text-(--shiki-dark) dark:[&_.shiki_span]:text-(--shiki-dark)";

function HighlightedCode({ code, language }: CodeBlockProps) {
	const highlighter = use(getHighlighter());
	const lang = highlighter.getLoadedLanguages().includes(language) ? language : "plaintext";
	const html = highlighter.codeToHtml(code, {
		lang,
		themes: SHIKI_THEMES,
		defaultColor: false,
	});

	return (
		<div
			className={`[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border/50 [&_pre]:p-3 [&_pre]:text-xs ${SHIKI_THEME_CLASSES}`}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki escapes the code it tokenizes, so its HTML output is safe
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}

export function CodeBlock({ code, language }: CodeBlockProps) {
	return (
		<Suspense
			fallback={
				<PreFallback>
					<code>{code}</code>
				</PreFallback>
			}
		>
			<HighlightedCode code={code} language={language} />
		</Suspense>
	);
}
