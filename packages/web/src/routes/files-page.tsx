import { useCallback, useMemo, useRef } from "react";
import {
	FileDiffList,
	type FileDiffListHandle,
	FilePicker,
	SidebarLayout,
} from "@/components/files";
import { Skeleton } from "@/components/ui/skeleton";
import { FILE_STATUS } from "@/lib/diff-types";
import { buildFileTree, flattenFileTree, sortFileTree } from "@/lib/file-tree";
import { type FileDiffEntry, useFileDiffEntries } from "@/lib/parse-diff";
import { useActiveFileOnScroll } from "@/lib/use-active-file-on-scroll";
import { useDiffPatch } from "@/lib/use-diff-patch";
import { useFileCollapseState } from "@/lib/use-file-collapse-state";
import { useViewState } from "@/lib/use-view-state";

interface FilesPageProps {
	runId: string;
}

export function FilesPage({ runId }: FilesPageProps) {
	const { data, isLoading, error } = useDiffPatch(runId);

	const rawEntries = useFileDiffEntries(data);
	const entries = useMemo(() => sortFileDiffEntries(rawEntries), [rawEntries]);
	const files = useMemo(() => entries.map((e) => e.file), [entries]);

	const { filePathSet, markFileViewed, unmarkFileViewed } = useViewState(runId);
	const handleToggleViewed = useCallback(
		(path: string) => {
			if (filePathSet.has(path)) unmarkFileViewed(path);
			else markFileViewed(path);
		},
		[filePathSet, markFileViewed, unmarkFileViewed],
	);

	// Deleted and viewed files start collapsed; useFileCollapseState lets the
	// user override per-file while keeping these defaults reactive.
	const defaultCollapsedFileIds = useMemo(() => {
		const ids = new Set<string>();
		for (const file of files) {
			if (file.status === FILE_STATUS.DELETED) ids.add(file.path);
		}
		for (const path of filePathSet) ids.add(path);
		return ids;
	}, [files, filePathSet]);

	const filePaths = useMemo(() => files.map((f) => f.path), [files]);
	const collapseState = useFileCollapseState(defaultCollapsedFileIds, filePaths, runId);

	const diffListRef = useRef<FileDiffListHandle>(null);
	const { activeFilePath, setActiveFileManually } = useActiveFileOnScroll(files);

	const handleSelectFile = useCallback(
		(filePath: string) => {
			setActiveFileManually(filePath);
			diffListRef.current?.scrollToFile(filePath);
		},
		[setActiveFileManually],
	);

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

function sortFileDiffEntries(entries: FileDiffEntry[]): FileDiffEntry[] {
	const entryByPath = new Map(entries.map((entry) => [entry.file.path, entry]));
	const sortedFiles = flattenFileTree(
		sortFileTree(buildFileTree(entries.map((entry) => entry.file))),
	);
	return sortedFiles.map((file) => {
		const entry = entryByPath.get(file.path);
		if (!entry) throw new Error(`Missing diff entry for sorted file ${file.path}`);
		return entry;
	});
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
