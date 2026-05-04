import { ExternalLink } from "lucide-react";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { useChapters } from "@/lib/use-chapters";

export function Topbar({ runId }: { runId: string | null }) {
	const { data } = useChapters(runId);
	const repoName = data?.run.repoName;

	return (
		<header className="sticky top-0 z-30 flex h-12 shrink-0 items-center justify-between border-border border-b bg-background px-6 lg:px-8">
			<div className="flex min-w-0 items-center gap-2 text-sm">
				{repoName && <span className="truncate font-medium text-foreground">{repoName}</span>}
			</div>
			<div className="flex shrink-0 items-center gap-2">
				<a
					href="https://stagereview.app"
					target="_blank"
					rel="noopener noreferrer"
					className="flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
				>
					Try the full Stage experience
					<ExternalLink className="size-3.5" />
				</a>
				<ThemeToggle />
			</div>
		</header>
	);
}
