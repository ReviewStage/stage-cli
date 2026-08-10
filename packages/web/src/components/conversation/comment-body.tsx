import { Markdown } from "@/components/ui/markdown";

interface CommentBodyProps {
	/** Raw markdown body — fallback when GitHub's rendered HTML is unavailable. */
	body: string;
	/** GitHub's server-rendered HTML (resolves @mentions, refs, emoji). */
	bodyHtml?: string | null;
}

/**
 * Renders a GitHub comment body through the CLI's Markdown component (shiki
 * code blocks, mermaid, GitHub image proxying, sanitized raw HTML). Hosted
 * renders GitHub's `body_html` directly through DOMPurify; the CLI instead
 * feeds it to the shared Markdown pipeline, matching how GitHub review
 * comments already render in `components/comments/review-thread.tsx`.
 */
export function CommentBody({ body, bodyHtml }: CommentBodyProps) {
	const content = bodyHtml != null && bodyHtml.length > 0 ? bodyHtml : body;
	if (!content) return null;
	return <Markdown content={content} allowHtml />;
}
