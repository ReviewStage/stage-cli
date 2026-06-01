import type {
	CheckConclusion,
	CheckItem,
	PullRequestCIStatus,
} from "@stagereview/types/pull-request";
import { CHECK_CONCLUSION, CHECK_ITEM_STATUS } from "@stagereview/types/pull-request";
import { Check, ChevronDown, Loader2, MinusCircle, X } from "lucide-react";
import { useEffect, useState } from "react";

import { AvatarStack } from "@/components/shared/avatar-stack";
import { CiStatusIcon } from "@/components/shared/ci-status-icon";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatElapsedTime } from "@/lib/format";
import { cn } from "@/lib/utils";

// ─── Visual state derivation from raw Octokit status/conclusion ─────────────────

const CHECK_VISUAL = {
	SUCCESS: "success",
	FAILURE: "failure",
	PENDING: "pending",
	SKIPPED: "skipped",
} as const;
type CheckVisual = (typeof CHECK_VISUAL)[keyof typeof CHECK_VISUAL];

function deriveCheckVisual(status: string, conclusion: CheckConclusion | null): CheckVisual {
	if (status !== CHECK_ITEM_STATUS.COMPLETED) return CHECK_VISUAL.PENDING;
	switch (conclusion) {
		case CHECK_CONCLUSION.SUCCESS:
			return CHECK_VISUAL.SUCCESS;
		case CHECK_CONCLUSION.SKIPPED:
		case CHECK_CONCLUSION.NEUTRAL:
		case CHECK_CONCLUSION.STALE:
			return CHECK_VISUAL.SKIPPED;
		default:
			return CHECK_VISUAL.FAILURE;
	}
}

const VISUAL_SEVERITY: Record<CheckVisual, number> = {
	[CHECK_VISUAL.SUCCESS]: 0,
	[CHECK_VISUAL.SKIPPED]: 1,
	[CHECK_VISUAL.PENDING]: 2,
	[CHECK_VISUAL.FAILURE]: 3,
};

function CheckVisualIcon({ visual, cls }: { visual: CheckVisual; cls: string }) {
	switch (visual) {
		case CHECK_VISUAL.SUCCESS:
			return <Check className={`${cls} text-green-500`} />;
		case CHECK_VISUAL.FAILURE:
			return <X className={`${cls} text-red-500`} />;
		case CHECK_VISUAL.PENDING:
			return <Loader2 className={`${cls} animate-spin text-yellow-500`} />;
		case CHECK_VISUAL.SKIPPED:
			return <MinusCircle className={`${cls} text-muted-foreground`} />;
	}
}

// ─── Check list (individual check rows + collapsible list) ──────────────────────

const VISIBLE_COUNT = 5;

function LiveElapsedTime({ startedAt }: { startedAt: string }) {
	const [now, setNow] = useState(() => new Date().toISOString());

	useEffect(() => {
		const id = setInterval(() => setNow(new Date().toISOString()), 1000);
		return () => clearInterval(id);
	}, []);

	const duration = formatElapsedTime(startedAt, now);
	return duration ? (
		<span className="shrink-0 text-xs text-muted-foreground">{duration}</span>
	) : null;
}

function CheckRow({ item }: { item: CheckItem }) {
	const visual = deriveCheckVisual(item.status, item.conclusion);
	const isInProgress = item.status === CHECK_ITEM_STATUS.IN_PROGRESS;
	const liveStartedAt = isInProgress ? item.startedAt : null;
	const staticDuration = liveStartedAt ? null : formatElapsedTime(item.startedAt, item.completedAt);
	const inner = (
		<>
			<CheckVisualIcon visual={visual} cls="size-3.5" />
			{item.avatarUrl && (
				<img src={item.avatarUrl} alt={item.appName} className="size-5 rounded-md" />
			)}
			<div className="min-w-0 flex-1">
				<span className="text-sm font-medium">{item.name}</span>
				{item.appName && (
					<span className="ml-1.5 text-xs text-muted-foreground">{item.appName}</span>
				)}
			</div>
			{liveStartedAt ? (
				<LiveElapsedTime startedAt={liveStartedAt} />
			) : (
				staticDuration && (
					<span className="shrink-0 text-xs text-muted-foreground">{staticDuration}</span>
				)
			)}
		</>
	);

	const rowCls = "flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0";

	if (item.url) {
		return (
			<a
				href={item.url}
				target="_blank"
				rel="noopener noreferrer"
				className={`${rowCls} hover:bg-muted/50`}
			>
				{inner}
			</a>
		);
	}

	return <div className={rowCls}>{inner}</div>;
}

function ChecksList({ items }: { items: CheckItem[] }) {
	const [open, setOpen] = useState(false);
	const needsCollapse = items.length > VISIBLE_COUNT;

	if (!needsCollapse) {
		return (
			<div>
				{items.map((item) => (
					<CheckRow key={`${item.source}-${item.id}`} item={item} />
				))}
			</div>
		);
	}

	const visible = items.slice(0, VISIBLE_COUNT);
	const hidden = items.slice(VISIBLE_COUNT);

	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<div>
				{visible.map((item) => (
					<CheckRow key={`${item.source}-${item.id}`} item={item} />
				))}
			</div>
			<CollapsibleContent className="border-t">
				{hidden.map((item) => (
					<CheckRow key={`${item.source}-${item.id}`} item={item} />
				))}
			</CollapsibleContent>
			<CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-center gap-1 border-t px-4 py-2 text-xs text-muted-foreground hover:bg-muted/50">
				<ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} />
				{open ? "Show less" : `Show ${hidden.length} more`}
			</CollapsibleTrigger>
		</Collapsible>
	);
}

// ─── App grouping + popover trigger ─────────────────────────────────────────────

interface AppGroup {
	avatarUrl: string;
	name: string;
	worstVisual: CheckVisual;
}

function groupChecksByApp(items: CheckItem[]): {
	groups: AppGroup[];
	orphanCount: number;
} {
	const byAvatar = new Map<string, AppGroup>();
	let orphanCount = 0;

	for (const item of items) {
		if (!item.avatarUrl) {
			orphanCount++;
			continue;
		}
		const visual = deriveCheckVisual(item.status, item.conclusion);
		const existing = byAvatar.get(item.avatarUrl);
		if (existing) {
			if (VISUAL_SEVERITY[visual] > VISUAL_SEVERITY[existing.worstVisual]) {
				existing.worstVisual = visual;
			}
		} else {
			byAvatar.set(item.avatarUrl, {
				avatarUrl: item.avatarUrl,
				name: item.appName,
				worstVisual: visual,
			});
		}
	}

	return { groups: [...byAvatar.values()], orphanCount };
}

function SubBadgeIcon({ visual }: { visual: CheckVisual }) {
	return <CheckVisualIcon visual={visual} cls="size-2" />;
}

interface CIChecksProps {
	state: PullRequestCIStatus;
	items: CheckItem[];
}

export function CIChecks({ state, items }: CIChecksProps) {
	const passedCount = items.filter((item) => {
		const v = deriveCheckVisual(item.status, item.conclusion);
		return v === CHECK_VISUAL.SUCCESS || v === CHECK_VISUAL.SKIPPED;
	}).length;

	// Sort: failures first, then pending, then success, then skipped
	const sorted = [...items].sort((a, b) => {
		const va = deriveCheckVisual(a.status, a.conclusion);
		const vb = deriveCheckVisual(b.status, b.conclusion);
		return VISUAL_SEVERITY[vb] - VISUAL_SEVERITY[va];
	});

	const { groups, orphanCount } = groupChecksByApp(items);

	const [open, setOpen] = useState(false);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors hover:bg-muted/50"
				>
					<span className="shrink-0">
						<CiStatusIcon state={state} size="xs" />
					</span>
					<span className="font-medium text-muted-foreground">
						{passedCount}/{items.length} Checks
					</span>
					{groups.length > 0 && (
						<AvatarStack
							items={groups.map((group) => ({
								key: group.avatarUrl,
								avatarUrl: group.avatarUrl,
								alt: group.name,
								tooltip: group.name,
								badge: <SubBadgeIcon visual={group.worstVisual} />,
							}))}
							size="md"
							overflowCount={orphanCount}
						/>
					)}
					<ChevronDown
						className={cn(
							"size-3 text-muted-foreground transition-transform duration-200",
							open && "rotate-180",
						)}
					/>
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-96 p-0">
				<ChecksList items={sorted} />
			</PopoverContent>
		</Popover>
	);
}
