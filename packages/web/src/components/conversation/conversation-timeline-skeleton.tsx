import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton for a comment card (avatar + header line, then body lines). */
function CommentSkeleton({ lines = 3 }: { lines?: number }) {
	return (
		<div className="rounded-xl border border-border bg-card px-5 py-4">
			<div className="flex items-start gap-3">
				<Skeleton className="size-8 shrink-0 rounded-full" />
				<div className="min-w-0 flex-1 space-y-2">
					<Skeleton className="h-4 w-44" />
					{Array.from({ length: lines }, (_, i) => (
						<Skeleton
							key={`line-${String(i)}`}
							className={`h-4 ${i === lines - 1 ? "w-2/3" : i === 1 ? "w-5/6" : "w-full"}`}
						/>
					))}
				</div>
			</div>
		</div>
	);
}

/** Skeleton for a commit group (icon + single line per row). */
function CommitGroupSkeleton({ count = 2 }: { count?: number }) {
	const widths = ["w-64", "w-52", "w-72"];
	return (
		<div className="space-y-2 rounded-xl border border-border bg-card px-5 py-4">
			{Array.from({ length: count }, (_, i) => (
				<div key={`commit-${String(i)}`} className="flex items-center gap-3">
					<Skeleton className="size-6 shrink-0 rounded-full" />
					<Skeleton className={`h-3.5 ${widths[i % widths.length]}`} />
				</div>
			))}
		</div>
	);
}

/** Skeleton for the Discussion column (comments + reviews). */
export function DiscussionTimelineSkeleton() {
	return (
		<div className="space-y-4">
			<CommentSkeleton lines={3} />
			<CommentSkeleton lines={2} />
		</div>
	);
}

/** Skeleton for the Events column (commits + metadata events). */
export function EventsTimelineSkeleton() {
	return (
		<div className="space-y-4">
			<CommitGroupSkeleton count={3} />
			<CommitGroupSkeleton count={2} />
		</div>
	);
}
