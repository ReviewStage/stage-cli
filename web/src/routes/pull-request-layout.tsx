import { type ChaptersResponse, ChaptersResponseSchema } from "@stage/types/chapters";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, FileText } from "lucide-react";
import { useMemo, useState } from "react";
import { SectionLabel } from "@/components/pull-request/section-label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { jsonFetch, useViewStateData } from "@/lib/use-view-state";
import { cn } from "@/lib/utils";
import { ChaptersIndexPage } from "./chapters-index-page";

const PR_TAB = {
	CHAPTERS: "chapters",
	FILES: "files",
} as const;
type PrTab = (typeof PR_TAB)[keyof typeof PR_TAB];

interface TabDef {
	id: PrTab;
	label: string;
	icon: React.ElementType;
	disabled?: boolean;
	disabledReason?: string;
}

const tabs: TabDef[] = [
	{ id: PR_TAB.CHAPTERS, label: "Chapters", icon: BookOpen },
	{
		id: PR_TAB.FILES,
		label: "Files changed",
		icon: FileText,
		disabled: true,
		disabledReason: "Coming soon — needs a diff endpoint from the CLI server",
	},
];

interface TabLinkProps {
	tab: TabDef;
	isActive: boolean;
	onSelect: (tab: PrTab) => void;
	countLabel?: string;
}

function TabLink({ tab, isActive, onSelect, countLabel }: TabLinkProps) {
	const { icon: Icon, label, disabled, disabledReason } = tab;
	const button = (
		<button
			type="button"
			disabled={disabled}
			onClick={() => !disabled && onSelect(tab.id)}
			className={cn(
				"flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 font-medium text-sm transition-colors",
				isActive
					? "bg-accent text-foreground"
					: "text-muted-foreground hover:bg-accent hover:text-foreground",
				disabled && "cursor-not-allowed opacity-60 hover:bg-transparent",
			)}
		>
			<Icon className={cn("size-4", isActive && !disabled && "text-primary")} aria-hidden="true" />
			<span>{label}</span>
			{countLabel !== undefined && (
				<span className="text-muted-foreground text-xs tabular-nums">{countLabel}</span>
			)}
		</button>
	);
	if (disabled && disabledReason) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<span>{button}</span>
				</TooltipTrigger>
				<TooltipContent side="bottom">{disabledReason}</TooltipContent>
			</Tooltip>
		);
	}
	return <span>{button}</span>;
}

function ErrorState({ error }: { error: unknown }) {
	return (
		<div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
			<div className="max-w-md text-center">
				<h1 className="font-semibold text-lg">Couldn't load chapters</h1>
				<p className="mt-2 text-muted-foreground text-sm">
					{error instanceof Error ? error.message : String(error)}
				</p>
			</div>
		</div>
	);
}

export function PullRequestLayout({ runId }: { runId: string }) {
	const { data, isLoading, error } = useQuery<ChaptersResponse>({
		queryKey: ["chapters", runId],
		// Parse at the boundary — schema drift surfaces here as a query error,
		// not as a render crash inside ChaptersIndexPage.
		queryFn: async () => {
			const raw = await jsonFetch<unknown>(`/api/runs/${encodeURIComponent(runId)}/chapters`);
			return ChaptersResponseSchema.parse(raw);
		},
	});
	const [activeTab, setActiveTab] = useState<PrTab>(PR_TAB.CHAPTERS);

	// Lift the viewed count out of ChaptersIndexPage so the tab strip can render
	// "X/N viewed". Read-only hook avoids instantiating the four mutation hooks
	// we don't use here, and chapterIdSet is a stable reference so the memo
	// actually caches across renders.
	const { chapterIdSet } = useViewStateData(runId);
	const chapters = data?.chapters;
	const viewedCount = useMemo(() => {
		if (!chapters) return 0;
		let n = 0;
		for (const c of chapters) if (chapterIdSet.has(c.externalId)) n++;
		return n;
	}, [chapters, chapterIdSet]);

	// Mirrors hosted's chapterCountLabel: just the total when nothing's been
	// viewed yet, otherwise "X/N viewed". Drops the count entirely if the
	// chapters API hasn't responded yet.
	const chapterCountLabel = (() => {
		if (chapters === undefined) return undefined;
		if (viewedCount > 0) return `${viewedCount}/${chapters.length} viewed`;
		return String(chapters.length);
	})();

	if (error) return <ErrorState error={error} />;

	return (
		<div className="flex min-h-screen flex-col bg-background text-foreground">
			<div className="flex-1 px-6 pt-6 pb-16 lg:px-8">
				<header className="mb-4 space-y-1">
					<SectionLabel>Run</SectionLabel>
					<p className="break-all font-mono text-foreground/80 text-xs">{data?.run.id ?? runId}</p>
				</header>
				<nav className="-mx-6 lg:-mx-8 sticky top-0 z-10 mb-6 flex items-center justify-between gap-4 border-border border-b bg-background/95 px-6 lg:px-8 pt-1 pb-2 backdrop-blur">
					<div className="flex shrink-0 items-center gap-1">
						{tabs.map((tab) => (
							<TabLink
								key={tab.id}
								tab={tab}
								isActive={tab.id === activeTab}
								onSelect={setActiveTab}
								countLabel={tab.id === PR_TAB.CHAPTERS ? chapterCountLabel : undefined}
							/>
						))}
					</div>
					{/* Right-side action group reserved for collapse-all / display
              settings when those land alongside the Files-changed tab. */}
					<div className="flex shrink-0 items-center gap-3" />
				</nav>
				{activeTab === PR_TAB.CHAPTERS && (
					<ChaptersIndexPage
						chapters={chapters}
						runId={runId}
						viewedCount={viewedCount}
						isLoading={isLoading}
					/>
				)}
			</div>
		</div>
	);
}
