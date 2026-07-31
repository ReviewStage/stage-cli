import type { GitHubThread } from "@stagereview/types/github-threads";
import { ChevronRight, ExternalLink } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Markdown } from "@/components/ui/markdown";
import { useCommentThreadsContext } from "@/lib/comment-threads-context";
import { CommentByline, gitHubByline } from "./comment-byline";

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
			<CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:rounded-b-none">
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
	// mergeThreads drops comment-less threads, so this only satisfies
	// noUncheckedIndexedAccess.
	const root = thread.comments[0];
	if (!root) return null;

	return (
		<div className="space-y-2 px-3 py-3">
			<div className="flex min-w-0 items-center gap-2">
				<p className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs">
					{thread.filePath}
				</p>
				<a
					href={root.url}
					target="_blank"
					rel="noopener noreferrer"
					className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs transition-colors hover:text-foreground hover:underline"
				>
					View on GitHub
					<ExternalLink className="size-3" aria-hidden="true" />
				</a>
			</div>
			<CommentByline comment={gitHubByline(root)} />
			<Markdown content={root.body} />
		</div>
	);
}
