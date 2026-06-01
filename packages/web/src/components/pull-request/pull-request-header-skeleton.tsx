import { Skeleton } from "@/components/ui/skeleton";

/**
 * Placeholder shown while the PR is being detected, matching the two-row layout
 * of {@link PullRequestHeader} so the real header swaps in without a layout shift.
 */
export function PullRequestHeaderSkeleton() {
	return (
		<header className="space-y-3">
			{/* Row 1: status pill + title + external link */}
			<div className="flex min-w-0 items-center gap-3">
				<Skeleton className="h-7 w-20 rounded-md" />
				<Skeleton className="h-7 w-64 max-w-full rounded-md" />
				<Skeleton className="ml-auto size-8 rounded-md" />
			</div>
			{/* Row 2: author + branch refs */}
			<div className="flex flex-wrap items-center gap-2">
				<Skeleton className="size-5 rounded-full" />
				<Skeleton className="h-4 w-44 rounded-md" />
				<span className="mx-0.5 h-3 w-px shrink-0 bg-border" />
				<Skeleton className="h-5 w-32 rounded-md" />
				<span className="shrink-0 text-muted-foreground">→</span>
				<Skeleton className="h-5 w-24 rounded-md" />
			</div>
		</header>
	);
}
