import { BookOpen, FileText } from "lucide-react";
import { useMemo, useState } from "react";
import { SectionLabel } from "@/components/pull-request/section-label";
import { useChapters } from "@/lib/use-chapters";
import { useFileDiffEntries } from "@/lib/parse-diff";
import { useDiffPatch } from "@/lib/use-diff-patch";
import { useViewStateData } from "@/lib/use-view-state";
import { cn } from "@/lib/utils";
import { ChaptersIndexPage } from "./chapters-index-page";
import { FilesPage } from "./files-page";

const PR_TAB = {
	CHAPTERS: "chapters",
	FILES: "files",
} as const;
type PrTab = (typeof PR_TAB)[keyof typeof PR_TAB];

interface TabDef {
	id: PrTab;
	label: string;
	icon: React.ElementType;
}

const tabs: TabDef[] = [
	{ id: PR_TAB.CHAPTERS, label: "Chapters", icon: BookOpen },
	{ id: PR_TAB.FILES, label: "Files changed", icon: FileText },
];

interface TabLinkProps {
	tab: TabDef;
	isActive: boolean;
	onSelect: (tab: PrTab) => void;
	countLabel?: string;
}

function TabLink({ tab, isActive, onSelect, countLabel }: TabLinkProps) {
	const { icon: Icon, label } = tab;
	return (
		<button
			type="button"
			onClick={() => onSelect(tab.id)}
			className={cn(
				"flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 font-medium text-sm transition-colors",
				isActive
					? "bg-accent text-foreground"
					: "text-muted-foreground hover:bg-accent hover:text-foreground",
			)}
		>
			<Icon className={cn("size-4", isActive && "text-primary")} aria-hidden="true" />
			<span>{label}</span>
			{countLabel !== undefined && (
				<span className="text-muted-foreground text-xs tabular-nums">{countLabel}</span>
			)}
		</button>
	);
}

function ErrorState({ error }: { error: unknown }) {
	return (
		<div className="flex flex-1 items-center justify-center p-6">
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
	const { data, isLoading, error } = useChapters(runId);
	const [activeTab, setActiveTab] = useState<PrTab>(PR_TAB.CHAPTERS);

	const { chapterIdSet, filePathSet } = useViewStateData(runId);
	const chapters = data?.chapters;
	const viewedChapterCount = useMemo(() => {
		if (!chapters) return 0;
		let n = 0;
		for (const c of chapters) if (chapterIdSet.has(c.externalId)) n++;
		return n;
	}, [chapters, chapterIdSet]);

	// Fetch diff at the layout level so the Files-changed tab can show a
	// "viewed" count that reflects the same patch the FilesPage will render.
	// react-query dedupes the request when FilesPage runs the same query key.
	const { data: patch } = useDiffPatch(runId);
	const fileEntries = useFileDiffEntries(patch);
	const totalFileCount = fileEntries.length;
	const viewedFileCount = useMemo(() => {
		if (totalFileCount === 0) return 0;
		let n = 0;
		for (const entry of fileEntries) {
			if (filePathSet.has(entry.file.path)) n++;
		}
		return n;
	}, [fileEntries, filePathSet, totalFileCount]);

	// Mirrors hosted's chapterCountLabel: just the total when nothing's been
	// viewed yet, otherwise "X/N viewed". Drops the count entirely if the
	// chapters API hasn't responded yet.
	const chapterCountLabel = (() => {
		if (chapters === undefined) return undefined;
		if (viewedChapterCount > 0) return `${viewedChapterCount}/${chapters.length} viewed`;
		return String(chapters.length);
	})();

	const fileCountLabel = (() => {
		if (patch === undefined) return undefined;
		if (viewedFileCount > 0) return `${viewedFileCount}/${totalFileCount} viewed`;
		return String(totalFileCount);
	})();

	if (error) return <ErrorState error={error} />;

	return (
		<div className="flex flex-1 flex-col">
			<div className="flex-1 px-6 pt-6 pb-16 lg:px-8">
				<header className="mb-4 space-y-1">
					<SectionLabel>Run</SectionLabel>
					<p className="break-all font-mono text-foreground/80 text-xs">{data?.run.id ?? runId}</p>
				</header>
				<nav className="-mx-6 lg:-mx-8 sticky top-12 z-10 mb-6 flex items-center justify-between gap-4 border-border border-b bg-background/95 px-6 lg:px-8 pt-1 pb-2 backdrop-blur">
					<div className="flex shrink-0 items-center gap-1">
						{tabs.map((tab) => (
							<TabLink
								key={tab.id}
								tab={tab}
								isActive={tab.id === activeTab}
								onSelect={setActiveTab}
								countLabel={
									tab.id === PR_TAB.CHAPTERS
										? chapterCountLabel
										: tab.id === PR_TAB.FILES
											? fileCountLabel
											: undefined
								}
							/>
						))}
					</div>
					{/* Right-side action group reserved for collapse-all / display
              settings in a follow-up. */}
					<div className="flex shrink-0 items-center gap-3" />
				</nav>
				{activeTab === PR_TAB.CHAPTERS && (
					<ChaptersIndexPage
						chapters={chapters}
						runId={runId}
						viewedCount={viewedChapterCount}
						isLoading={isLoading}
					/>
				)}
				{activeTab === PR_TAB.FILES && <FilesPage runId={runId} />}
			</div>
		</div>
	);
}
