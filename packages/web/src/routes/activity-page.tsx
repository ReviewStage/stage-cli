import type { ResolvedThreadInfo } from "@stagereview/types";
import { AlertTriangle } from "lucide-react";
import { useMemo, useState } from "react";
import {
	DiscussionTimeline,
	DiscussionTimelineSkeleton,
	EventsTimeline,
	EventsTimelineSkeleton,
} from "@/components/conversation";
import { SectionLabel } from "@/components/pull-request/section-label";
import { Switch } from "@/components/ui/switch";
import { usePullRequest } from "@/lib/use-pull-request";
import { useTimeline } from "@/lib/use-timeline";

// Vendored from hosted Stage's `$orgSlug.$repo.pull.$number.activity.tsx`.
// Adaptations: the timeline comes from the run-scoped hook instead of the
// hosted PR context, framer-motion entrance animations are dropped (not a CLI
// dependency), and local (non-PR) runs get an explicit empty state.

export function ActivityPage({ runId }: { runId: string }) {
	const { data: prData } = usePullRequest(runId);
	const pullRequest = prData?.pullRequest ?? null;
	const { data, error } = useTimeline(runId, pullRequest?.number ?? null);
	const timeline = data?.timeline ?? null;
	const [hideResolved, setHideResolved] = useState(false);
	const [hideBots, setHideBots] = useState(false);

	const resolvedThreads = useMemo(
		() =>
			new Map<number, ResolvedThreadInfo>(
				Object.entries(timeline?.resolvedThreads ?? {}).map(([key, value]) => [Number(key), value]),
			),
		[timeline?.resolvedThreads],
	);

	// The layout only offers the Activity tab for PR runs, but the URL is still
	// reachable directly — degrade with an explicit message instead of a skeleton.
	if (prData && !pullRequest) {
		return (
			<div className="flex flex-col items-center justify-center py-16 text-center">
				<p className="text-muted-foreground text-sm">
					Activity is only available for runs associated with a GitHub pull request.
				</p>
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex items-start gap-3 rounded-lg border border-destructive/50 p-4 text-destructive">
				<AlertTriangle className="mt-0.5 size-4 shrink-0" />
				<div className="min-w-0 text-sm">
					<p className="font-medium">Failed to load timeline</p>
					<p className="mt-1 text-destructive/90">
						{error instanceof Error && error.message ? error.message : "An unknown error occurred."}
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="grid h-full grid-cols-1 gap-6 @4xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
			{/* Left column — Discussion (comments + reviews) */}
			<div className="scrollbar-thin @4xl:sticky @4xl:top-[var(--content-top)] @4xl:max-h-[calc(var(--main-height)_-_var(--content-top))] min-w-0 @4xl:overflow-y-auto @4xl:pb-6">
				<div className="sticky top-0 z-10 bg-background pb-4">
					<div className="flex items-center justify-between">
						<SectionLabel>Discussion</SectionLabel>
						<div className="flex items-center gap-3">
							<label htmlFor="hide-resolved" className="flex cursor-pointer items-center gap-1.5">
								<span className="text-[0.6875rem] text-muted-foreground">Hide resolved</span>
								<Switch
									id="hide-resolved"
									checked={hideResolved}
									onCheckedChange={setHideResolved}
								/>
							</label>
							<label htmlFor="hide-bots" className="flex cursor-pointer items-center gap-1.5">
								<span className="text-[0.6875rem] text-muted-foreground">Hide bots</span>
								<Switch id="hide-bots" checked={hideBots} onCheckedChange={setHideBots} />
							</label>
						</div>
					</div>
				</div>
				{!timeline ? (
					<DiscussionTimelineSkeleton />
				) : (
					<DiscussionTimeline
						events={timeline.events}
						resolvedThreads={resolvedThreads}
						reactionDetails={timeline.reactionDetails}
						filters={{ hideResolved, hideBots }}
					/>
				)}
			</div>

			{/* Right column — Events (commits + metadata events) */}
			<div className="scrollbar-thin @4xl:sticky @4xl:top-[var(--content-top)] @4xl:max-h-[calc(var(--main-height)_-_var(--content-top))] min-w-0 @4xl:overflow-y-auto @4xl:pb-6">
				<div className="sticky top-0 z-10 bg-background pb-4">
					<div className="flex min-h-5 items-center">
						<SectionLabel>Events</SectionLabel>
					</div>
				</div>
				{!timeline || !pullRequest ? (
					<EventsTimelineSkeleton />
				) : (
					<EventsTimeline pullRequest={pullRequest} events={timeline.events} />
				)}
			</div>
		</div>
	);
}
