import type { GitHubComment, GitHubThread } from "@stagereview/types/github-threads";
import { ChevronRight, ExternalLink } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Markdown } from "@/components/ui/markdown";
import { useCommentThreadsContext } from "@/lib/comment-threads-context";
import { formatTimeAgo } from "@/lib/format";

/**
 * GitHub threads that can't be shown inline — GitHub marked them outdated, the
 * range spans both diff sides, or the PR head moved past this run's import.
 * Listed here so review feedback never silently disappears.
 */
export function OutdatedThreads() {
	const { merged } = useCommentThreadsContext();
	if (merged.outdated.length === 0) return null;

	return (
		<Collapsible className="mt-6 rounded-xl border border-border bg-card">
			<CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2.5 text-left">
				<ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-90" />
				<span className="font-medium text-sm">Outdated comments</span>
				<span className="text-muted-foreground text-xs tabular-nums">{merged.outdated.length}</span>
				<span className="ml-auto hidden text-muted-foreground text-xs @xl:inline">
					Not viewable inline — re-import to update
				</span>
			</CollapsibleTrigger>
			<CollapsibleContent className="divide-y divide-border border-border border-t">
				{merged.outdated.map((thread) => (
					<OutdatedThreadItem key={thread.githubThreadId} thread={thread} />
				))}
			</CollapsibleContent>
		</Collapsible>
	);
}

function OutdatedThreadItem({ thread }: { thread: GitHubThread }) {
	// A thread always arrives with its root comment; the empty case only exists
	// because noUncheckedIndexedAccess types the lookup as possibly-undefined.
	const root = thread.comments[0];
	return (
		<div className="space-y-2 px-3 py-3">
			<div className="flex min-w-0 items-center gap-2">
				<p className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs">
					{thread.filePath}
				</p>
				{root && (
					<a
						href={root.url}
						target="_blank"
						rel="noopener noreferrer"
						className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs transition-colors hover:text-foreground hover:underline"
					>
						View on GitHub
						<ExternalLink className="size-3" aria-hidden="true" />
					</a>
				)}
			</div>
			{root && <RootComment comment={root} />}
		</div>
	);
}

function RootComment({ comment }: { comment: GitHubComment }) {
	const author = comment.author.name ?? comment.author.login;
	return (
		<>
			<div className="flex items-center gap-1.5 text-muted-foreground text-sm">
				<Avatar className="size-5 shrink-0">
					{comment.author.avatarUrl && <AvatarImage src={comment.author.avatarUrl} alt={author} />}
					<AvatarFallback className="text-[10px]">{author.trim()[0]?.toUpperCase()}</AvatarFallback>
				</Avatar>
				<span className="truncate font-medium text-foreground">{author}</span>
				<time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()}>
					{formatTimeAgo(comment.createdAt)}
				</time>
			</div>
			<Markdown content={comment.body} />
		</>
	);
}
