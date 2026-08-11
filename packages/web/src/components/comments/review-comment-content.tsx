import { Markdown } from "@/components/ui/markdown";

interface ReviewCommentContentProps {
	body: string;
	bodyHtml: string | null;
}

// GitHub comments render GitHub's own server-rendered HTML (resolves
// @mentions, #refs, emoji); local comments render their raw markdown. Markdown
// handles image proxying internally, so no extra props are needed.
export function ReviewCommentContent({ body, bodyHtml }: ReviewCommentContentProps) {
	if (bodyHtml !== null) {
		return <Markdown content={bodyHtml} allowHtml />;
	}
	return <Markdown content={body} />;
}
