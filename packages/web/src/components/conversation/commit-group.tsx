import type { TimelineCommittedEvent } from "@stagereview/types";
import { GitCommit } from "lucide-react";
import { formatTimeAgo } from "@/lib/format";

interface CommitGroupProps {
	commits: TimelineCommittedEvent[];
	/** Base repository URL, e.g. "https://github.com/owner/repo" */
	repoUrl: string;
}

export function CommitGroup({ commits, repoUrl }: CommitGroupProps) {
	return (
		<div className="space-y-2">
			{commits.map((commit) => {
				const firstLine = commit.message.split("\n")[0];
				const shortSha = commit.sha.slice(0, 7);
				const commitUrl = `${repoUrl}/commit/${commit.sha}`;

				return (
					<div key={commit.sha} className="flex items-start gap-3">
						<span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
							<GitCommit className="size-3" />
						</span>
						<div className="min-w-0 flex-1 text-sm">
							<a
								href={commitUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="font-medium text-foreground hover:underline"
								title={commit.message}
							>
								{firstLine}
							</a>
							<span className="ml-2 text-muted-foreground">
								<a
									href={commitUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="font-mono text-xs hover:underline"
								>
									{shortSha}
								</a>
								{commit.author.date && (
									<>
										{" "}
										<time
											dateTime={commit.author.date}
											title={new Date(commit.author.date).toLocaleString()}
										>
											{formatTimeAgo(commit.author.date)}
										</time>
									</>
								)}
							</span>
						</div>
					</div>
				);
			})}
		</div>
	);
}
