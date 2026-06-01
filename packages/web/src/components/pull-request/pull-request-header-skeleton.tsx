import { Skeleton } from "@/components/ui/skeleton";

/**
 * Placeholder shown while the PR is being detected, so the real header swaps in
 * without a layout shift. Vendored from hosted Stage's PR page.
 */
export function PullRequestHeaderSkeleton() {
	return (
		<header className="space-y-4">
			<div className="flex items-start gap-3">
				<Skeleton className="hidden h-7 w-20 rounded-full @xl:block" />
				<div className="min-w-0 flex-1 space-y-3">
					<Skeleton className="h-8 w-full max-w-3xl" />
					<div className="flex flex-wrap items-center gap-3">
						<Skeleton className="size-6 rounded-full" />
						<Skeleton className="h-4 w-24" />
						<Skeleton className="h-4 w-36" />
					</div>
				</div>
				<div className="ml-auto flex shrink-0 items-center gap-2">
					<Skeleton className="size-8 rounded-md" />
					<Skeleton className="size-8 rounded-md" />
				</div>
			</div>
			<div className="flex flex-wrap gap-2">
				<Skeleton className="h-6 w-16 rounded-md" />
				<Skeleton className="h-6 w-20 rounded-md" />
				<Skeleton className="h-6 w-24 rounded-md" />
			</div>
		</header>
	);
}
