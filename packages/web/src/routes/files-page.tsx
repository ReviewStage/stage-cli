import { useCallback, useMemo, useRef, useState } from "react";
import {
	type CollapseState,
	FileDiffList,
	type FileDiffListHandle,
	FilePicker,
	SidebarLayout,
} from "@/components/files";
import { Skeleton } from "@/components/ui/skeleton";
import { useFileDiffEntries } from "@/lib/parse-diff";
import { useActiveFileOnScroll } from "@/lib/use-active-file-on-scroll";
import { useDiffPatch } from "@/lib/use-diff-patch";
import { useFileNavigationKeys } from "@/lib/use-file-navigation-keys";
import { useViewState } from "@/lib/use-view-state";

interface FilesPageProps {
	runId: string;
}

export function FilesPage({ runId }: FilesPageProps) {
	const { data, isLoading, error } = useDiffPatch(runId);

	const entries = useFileDiffEntries(data);
	const files = useMemo(() => entries.map((e) => e.file), [entries]);

	const { filePathSet, markFileViewed, unmarkFileViewed } = useViewState(runId);
	const handleToggleViewed = useCallback(
		(path: string) => {
			if (filePathSet.has(path)) unmarkFileViewed(path);
			else markFileViewed(path);
		},
		[filePathSet, markFileViewed, unmarkFileViewed],
	);

	const collapseState = useCollapseState(files);

	const diffListRef = useRef<FileDiffListHandle>(null);
	const { activeFilePath, setActiveFileManually } = useActiveFileOnScroll(files);

	const handleSelectFile = useCallback(
		(filePath: string) => {
			setActiveFileManually(filePath);
			diffListRef.current?.scrollToFile(filePath);
		},
		[setActiveFileManually],
	);

	useFileNavigationKeys(files, handleSelectFile, files.length > 0);

	if (error) return <FilesPageError error={error} />;
	if (isLoading || data === undefined) return <FilesPageSkeleton />;

	return (
		<SidebarLayout
			sidebar={
				<FilePicker
					files={files}
					activeFilePath={activeFilePath}
					viewedPathSet={filePathSet}
					onSelectFile={handleSelectFile}
				/>
			}
		>
			<FileDiffList
				ref={diffListRef}
				entries={entries}
				emptyMessage="No files changed in this run."
				viewedPathSet={filePathSet}
				onToggleViewed={handleToggleViewed}
				collapseState={collapseState}
			/>
		</SidebarLayout>
	);
}

function useCollapseState(files: { path: string }[]): CollapseState {
	const [collapsedFiles, setCollapsedFiles] = useState<ReadonlySet<string>>(() => new Set());

	const toggleFileCollapsed = useCallback((filePath: string) => {
		setCollapsedFiles((prev) => {
			const next = new Set(prev);
			if (next.has(filePath)) next.delete(filePath);
			else next.add(filePath);
			return next;
		});
	}, []);

	const collapseAllFiles = useCallback(() => {
		setCollapsedFiles(new Set(files.map((f) => f.path)));
	}, [files]);

	const expandAllFiles = useCallback(() => {
		setCollapsedFiles(new Set());
	}, []);

	return useMemo(
		() => ({ collapsedFiles, toggleFileCollapsed, collapseAllFiles, expandAllFiles }),
		[collapsedFiles, toggleFileCollapsed, collapseAllFiles, expandAllFiles],
	);
}

function FilesPageSkeleton() {
	return (
		<div className="space-y-4">
			<SkeletonFile />
			<SkeletonFile />
			<SkeletonFile />
			<SkeletonFile />
		</div>
	);
}

function SkeletonFile() {
	return (
		<div className="rounded-lg border border-border">
			<Skeleton className="h-10 w-full rounded-b-none" />
			<div className="space-y-1 p-4">
				<Skeleton className="h-4 w-full" />
				<Skeleton className="h-4 w-full" />
				<Skeleton className="h-4 w-3/4" />
			</div>
		</div>
	);
}

function FilesPageError({ error }: { error: unknown }) {
	const message = error instanceof Error ? error.message : String(error);
	return (
		<div className="flex h-96 flex-col items-center justify-center rounded-xl border border-border bg-card/50 p-6 text-center">
			<h2 className="font-semibold text-base">Couldn't load file diffs</h2>
			<p className="mt-2 text-muted-foreground text-sm">{message}</p>
		</div>
	);
}
