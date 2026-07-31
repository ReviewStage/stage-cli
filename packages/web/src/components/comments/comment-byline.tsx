import type { GitHubComment } from "@stagereview/types/github-threads";
import { User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatTimeAgo } from "@/lib/format";
import { useViewer } from "@/lib/use-viewer";

/** The attribution line of a comment, whatever wrote it — the viewer or GitHub. */
export interface BylineComment {
	author: { name: string; avatarUrl: string | null };
	createdAt: string;
	/** Links the timestamp out to the comment on GitHub. */
	url?: string;
}

export function gitHubByline(comment: GitHubComment): BylineComment {
	return {
		author: {
			name: comment.author.name ?? comment.author.login,
			avatarUrl: comment.author.avatarUrl,
		},
		createdAt: comment.createdAt,
		url: comment.url,
	};
}

/** Byline for a locally authored comment — the viewer wrote all of them. */
export function ViewerByline({ createdAt }: { createdAt: string }) {
	const viewer = useViewer();
	return <CommentByline comment={{ author: viewer, createdAt }} />;
}

export function CommentByline({ comment }: { comment: BylineComment }) {
	const { author, createdAt, url } = comment;
	const initial = author.name.trim()[0]?.toUpperCase();
	const timestamp = (
		<time dateTime={createdAt} title={new Date(createdAt).toLocaleString()}>
			{formatTimeAgo(createdAt)}
		</time>
	);
	return (
		<p className="flex min-w-0 flex-1 items-center gap-1.5 text-muted-foreground text-sm">
			<Avatar className="size-5 shrink-0">
				{author.avatarUrl && <AvatarImage src={author.avatarUrl} alt={author.name} />}
				<AvatarFallback className="text-[10px]">
					{initial ?? <User className="size-3" />}
				</AvatarFallback>
			</Avatar>
			<span className="truncate font-medium text-foreground">{author.name}</span>
			{url ? (
				<a
					href={url}
					target="_blank"
					rel="noopener noreferrer"
					className="shrink-0 rounded-sm transition-colors hover:text-foreground hover:underline"
				>
					{timestamp}
				</a>
			) : (
				timestamp
			)}
		</p>
	);
}
