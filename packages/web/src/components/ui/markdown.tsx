import { type ComponentPropsWithoutRef, isValidElement, memo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { MermaidDiagram } from "@/components/shared/mermaid-diagram";
import { CodeBlock } from "@/components/ui/code-block";
import { pre as SharedPre } from "@/components/ui/markdown-components";
import { proxyGitHubImageSrcset, proxyGitHubImageUrl } from "@/lib/github-image-proxy";
import { cn } from "@/lib/utils";

interface MarkdownProps {
	content: string;
	className?: string;
	/** When true, descendants inherit font-size and line-height from the parent. */
	inheritSize?: boolean;
	/**
	 * Render embedded raw HTML (sanitized). Off by default so plain markdown stays
	 * HTML-free; enable for GitHub-sourced content like PR descriptions, whose bodies
	 * commonly contain HTML badge blocks (`<picture>`/`<img>` from bots).
	 */
	allowHtml?: boolean;
}

// Extend rehype-sanitize's GitHub schema to keep the `<picture>`/`<source>` image
// badges GitHub renders in PR bodies, while still stripping scripts/handlers.
// `target`/`rel` are deliberately NOT allowed through: the `a` renderer below
// forces target="_blank" rel="noopener noreferrer", so letting a raw link's own
// rel/target survive sanitization could only weaken that (e.g. rel="opener").
const htmlSchema = {
	...defaultSchema,
	tagNames: [...(defaultSchema.tagNames ?? []), "picture", "source"],
	attributes: {
		...defaultSchema.attributes,
		source: ["srcSet", "media", "type", "sizes"],
		img: [...(defaultSchema.attributes?.img ?? []), "width", "height", "loading"],
	},
};

// Fenced ```mermaid blocks render as diagrams; fenced ```lang blocks render through
// the shiki-backed CodeBlock. `pre` unwraps mermaid so the diagram isn't nested in a
// code frame, and `code` keeps its inline styling for everything else.
const code = ({ className, children, ...props }: ComponentPropsWithoutRef<"code">) => {
	if (className?.includes("language-mermaid")) {
		return <MermaidDiagram chart={String(children).replace(/\n$/, "")} />;
	}
	return (
		<code
			className={cn(
				"rounded-sm bg-muted/60 px-1 py-0.5 font-medium text-xs [:where(pre)>&]:rounded-none [:where(pre)>&]:bg-transparent [:where(pre)>&]:p-0 [:where(pre)>&]:font-normal",
				className,
			)}
			{...props}
		>
			{children}
		</code>
	);
};

const pre = ({ children, ...rest }: ComponentPropsWithoutRef<"pre">) => {
	if (
		isValidElement<{ className?: string; children?: ReactNode }>(children) &&
		typeof children.props.className === "string"
	) {
		if (children.props.className.includes("language-mermaid")) {
			return children;
		}
		const language = children.props.className.match(/language-([\w+#.-]+)/)?.[1];
		if (language) {
			const codeText = String(children.props.children).replace(/\n$/, "");
			return <CodeBlock code={codeText} language={language} />;
		}
	}
	return <SharedPre {...rest}>{children}</SharedPre>;
};

const a = ({ className, ...props }: ComponentPropsWithoutRef<"a">) => (
	<a
		className={cn("text-primary underline-offset-2 hover:underline", className)}
		target="_blank"
		rel="noopener noreferrer"
		{...props}
	/>
);

const p = ({ className, ...props }: ComponentPropsWithoutRef<"p">) => (
	<p
		className={cn("md-p mt-2 mb-2 text-sm leading-relaxed first:mt-0 last:mb-0", className)}
		{...props}
	/>
);

const ul = ({ className, ...props }: ComponentPropsWithoutRef<"ul">) => (
	<ul className={cn("my-2 list-disc pl-4 text-sm [&>li]:mt-1", className)} {...props} />
);

const ol = ({ className, ...props }: ComponentPropsWithoutRef<"ol">) => (
	<ol className={cn("my-2 list-decimal pl-4 text-sm [&>li]:mt-1", className)} {...props} />
);

const li = ({ className, ...props }: ComponentPropsWithoutRef<"li">) => (
	<li className={cn("leading-relaxed", className)} {...props} />
);

const blockquote = ({ className, ...props }: ComponentPropsWithoutRef<"blockquote">) => (
	<blockquote
		className={cn(
			"my-2 flex gap-2 rounded-md border-amber-500/70 border-l-2 bg-amber-500/5 py-2 pr-3 pl-3 text-sm dark:bg-amber-500/10",
			className,
		)}
		{...props}
	/>
);

// GitHub-hosted attachment images are rewritten through the local image proxy so
// private attachments load; everything else passes through untouched.
const img = ({ className, alt, src, ...props }: ComponentPropsWithoutRef<"img">) => (
	<img
		className={cn("inline-block max-w-full rounded", className)}
		alt={alt ?? ""}
		src={typeof src === "string" ? proxyGitHubImageUrl(src) : src}
		{...props}
	/>
);

const source = ({ srcSet, ...props }: ComponentPropsWithoutRef<"source">) => (
	<source srcSet={srcSet === undefined ? srcSet : proxyGitHubImageSrcset(srcSet)} {...props} />
);

const components = { code, pre, a, p, ul, ol, li, blockquote, img, source };

function MarkdownImpl({ content, className, inheritSize, allowHtml }: MarkdownProps) {
	return (
		<div
			className={cn(
				inheritSize && "[&_*]:[font-size:inherit] [&_*]:[line-height:inherit]",
				className,
			)}
		>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={allowHtml ? [rehypeRaw, [rehypeSanitize, htmlSchema]] : undefined}
				components={components}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
}

export const Markdown = memo(MarkdownImpl);
