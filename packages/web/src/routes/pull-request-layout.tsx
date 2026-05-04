import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { BookOpen, FileText } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { SectionLabel } from "@/components/pull-request/section-label";
import { useFileDiffEntries } from "@/lib/parse-diff";
import { useChapters } from "@/lib/use-chapters";
import { useDiffPatch } from "@/lib/use-diff-patch";
import { countViewedChapters, useViewStateData } from "@/lib/use-view-state";
import { cn } from "@/lib/utils";

const PR_TAB = {
	CHAPTERS: "chapters",
	FILES: "files",
} as const;
type PrTab = (typeof PR_TAB)[keyof typeof PR_TAB];

const tabs = [
	{ id: PR_TAB.CHAPTERS, label: "Chapters", icon: BookOpen, to: "/runs/$runId" as const },
	{
		id: PR_TAB.FILES,
		label: "Files changed",
		icon: FileText,
		to: "/runs/$runId/files" as const,
	},
];

interface TabLinkProps {
	tab: (typeof tabs)[number];
	runId: string;
	isActive: boolean;
	countLabel?: string;
}

function TabLink({ tab, runId, isActive, countLabel }: TabLinkProps) {
	const { icon: Icon, label, to } = tab;
	return (
		<Link
			to={to}
			params={{ runId }}
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
		</Link>
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
	const { data, error } = useChapters(runId);
	const activeTab = useRouterState({
		select: (state): PrTab => {
			const routeIds = new Set(state.matches.map((match) => match.routeId));
			if (routeIds.has("/runs/$runId/files")) return PR_TAB.FILES;
			return PR_TAB.CHAPTERS;
		},
	});

	const { chapterIdSet, filePathSet } = useViewStateData(runId);
	const chapters = data?.chapters;
	const viewedChapterCount = useMemo(
		() => countViewedChapters(chapters, chapterIdSet),
		[chapters, chapterIdSet],
	);

	// Fetched here so the Files tab's "N/M viewed" label can render before the
	// user clicks into the tab; react-query dedupes the same fetch from FilesPage.
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

	// `undefined` while loading so the count chip is suppressed entirely;
	// otherwise the bare total until at least one item is viewed.
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

	// `--content-top` and `--main-height` are read by the sticky file picker.
	const navRef = useRef<HTMLElement>(null);
	const [navHeight, setNavHeight] = useState(0);
	useEffect(() => {
		const el = navRef.current;
		if (!el) return;
		const observer = new ResizeObserver(() => setNavHeight(el.getBoundingClientRect().height));
		observer.observe(el);
		setNavHeight(el.getBoundingClientRect().height);
		return () => observer.disconnect();
	}, []);

	if (error) return <ErrorState error={error} />;

	// 48 = the app-shell Topbar's `h-12`, which the picker also has to clear.
	const layoutStyle = {
		"--content-top": `${48 + navHeight}px`,
		"--main-height": "100vh",
	} as CSSProperties;

	return (
		<div className="flex flex-1 flex-col" style={layoutStyle}>
			<div className="flex-1 px-6 pt-6 pb-16 lg:px-8">
				<header className="mb-4 space-y-1">
					<SectionLabel>Run</SectionLabel>
					<p className="break-all font-mono text-foreground/80 text-xs">{data?.run.id ?? runId}</p>
				</header>
				<nav
					ref={navRef}
					className="-mx-6 lg:-mx-8 sticky top-12 z-20 mb-6 flex items-center justify-between gap-4 bg-background/95 px-6 lg:px-8 pt-1 pb-2 backdrop-blur"
				>
					<div className="flex shrink-0 items-center gap-1">
						{tabs.map((tab) => (
							<TabLink
								key={tab.id}
								tab={tab}
								runId={runId}
								isActive={tab.id === activeTab}
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
					<div className="flex shrink-0 items-center gap-3" />
				</nav>
				<Outlet />
			</div>
		</div>
	);
}
