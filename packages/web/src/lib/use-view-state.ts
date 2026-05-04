import { type ViewState, ViewStateSchema } from "@stagereview/types/view-state";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

export type { ViewState };

interface MutationContext {
	/** Snapshot of the cache entry the optimistic write replaced. */
	previous: ViewState | undefined;
	/**
	 * The query key the snapshot was taken against. Captured at onMutate time so
	 * onError/onSettled target the right cache entry even if `runId` changed
	 * (and thus `queryKey` changed) while the mutation was in flight — TanStack
	 * Query swaps the latest closures via setOptions on each render, so the
	 * key that was stable when we wrote the optimistic update is the only key
	 * we can safely roll back / invalidate.
	 */
	queryKey: readonly unknown[];
}

const VIEW_STATE_ROOT = "view-state";

export function viewStateQueryKey(runId: string): readonly unknown[] {
	return [VIEW_STATE_ROOT, runId];
}

export async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
	const res = await fetch(url, init);
	if (!res.ok) {
		throw new Error(`${init?.method ?? "GET"} ${url} failed: ${res.status}`);
	}
	// POST/DELETE handlers can return an empty body — read as text first so
	// JSON.parse doesn't throw SyntaxError on `""`.
	const text = await res.text();
	return (text ? JSON.parse(text) : {}) as T;
}

async function fetchViewState(runId: string): Promise<ViewState> {
	// Parse at the boundary so a server-side schema drift surfaces as a query
	// error here, not as a render crash deeper in the component tree.
	const raw = await jsonFetch<unknown>(`/api/runs/${encodeURIComponent(runId)}/view-state`);
	return ViewStateSchema.parse(raw);
}

const postChapterView = (id: string) =>
	jsonFetch<unknown>(`/api/chapter-view/${encodeURIComponent(id)}`, { method: "POST" });

const deleteChapterView = (id: string) =>
	jsonFetch<unknown>(`/api/chapter-view/${encodeURIComponent(id)}`, { method: "DELETE" });

const postKeyChangeView = (id: string) =>
	jsonFetch<unknown>(`/api/key-change-view/${encodeURIComponent(id)}`, { method: "POST" });

const deleteKeyChangeView = (id: string) =>
	jsonFetch<unknown>(`/api/key-change-view/${encodeURIComponent(id)}`, { method: "DELETE" });

const fileViewRequest = (method: "POST" | "DELETE", path: string): RequestInit => ({
	method,
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({ path }),
});

const postFileView = (runId: string, path: string) =>
	jsonFetch<unknown>(
		`/api/runs/${encodeURIComponent(runId)}/file-views`,
		fileViewRequest("POST", path),
	);

const deleteFileView = (runId: string, path: string) =>
	jsonFetch<unknown>(
		`/api/runs/${encodeURIComponent(runId)}/file-views`,
		fileViewRequest("DELETE", path),
	);

export interface UseViewStateDataResult {
	/** Stable reference; mutates only when the underlying query data changes. */
	chapterIdSet: ReadonlySet<string>;
	/** Stable reference; mutates only when the underlying query data changes. */
	keyChangeIdSet: ReadonlySet<string>;
	/** Stable reference; mutates only when the underlying query data changes. */
	filePathSet: ReadonlySet<string>;
	isChapterViewed: (chapterId: string) => boolean;
	isKeyChangeChecked: (keyChangeId: string) => boolean;
	isFileViewed: (filePath: string) => boolean;
	isLoading: boolean;
	error: unknown;
}

export interface UseViewStateResult extends UseViewStateDataResult {
	markChapterViewed: (chapterId: string) => void;
	unmarkChapterViewed: (chapterId: string) => void;
	markKeyChangeChecked: (keyChangeId: string) => void;
	unmarkKeyChangeChecked: (keyChangeId: string) => void;
	markFileViewed: (filePath: string) => void;
	unmarkFileViewed: (filePath: string) => void;
}

export function countViewedChapters(
	chapters: ReadonlyArray<{ externalId: string }> | undefined,
	chapterIdSet: ReadonlySet<string>,
): number {
	if (!chapters) return 0;
	let count = 0;
	for (const c of chapters) if (chapterIdSet.has(c.externalId)) count++;
	return count;
}

// Returns stable Sets so callers can use them as effect/memo deps.
// Read-only — `useViewState` adds the mutation hooks on top of this.
export function useViewStateData(runId: string): UseViewStateDataResult {
	const { data, isLoading, error } = useQuery<ViewState>({
		queryKey: viewStateQueryKey(runId),
		queryFn: () => fetchViewState(runId),
		enabled: runId !== "",
	});

	const chapterIdSet = useMemo(() => new Set(data?.chapterIds ?? []), [data?.chapterIds]);
	const keyChangeIdSet = useMemo(() => new Set(data?.keyChangeIds ?? []), [data?.keyChangeIds]);
	const filePathSet = useMemo(() => new Set(data?.filePaths ?? []), [data?.filePaths]);

	return useMemo(
		() => ({
			chapterIdSet,
			keyChangeIdSet,
			filePathSet,
			isChapterViewed: (id: string) => chapterIdSet.has(id),
			isKeyChangeChecked: (id: string) => keyChangeIdSet.has(id),
			isFileViewed: (path: string) => filePathSet.has(path),
			isLoading,
			error,
		}),
		[chapterIdSet, keyChangeIdSet, filePathSet, isLoading, error],
	);
}

export function useViewState(runId: string): UseViewStateResult {
	const queryClient = useQueryClient();
	const queryKey = useMemo(() => viewStateQueryKey(runId), [runId]);
	const data = useViewStateData(runId);

	// Optimistic-update helpers. Await cancelQueries before writing so any
	// in-flight refetch can't resolve and overwrite the optimistic cache.
	// onError rolls back to the snapshot; onSettled invalidates to reconcile
	// with whatever the server actually committed. Both target ctx.queryKey
	// (captured at onMutate time) so a runId change mid-mutation can't cause
	// the rollback/invalidate to land on the wrong cache entry.
	const snapshotAndPatch = async (
		patch: (prev: ViewState) => ViewState,
	): Promise<MutationContext> => {
		await queryClient.cancelQueries({ queryKey });
		const previous = queryClient.getQueryData<ViewState>(queryKey);
		queryClient.setQueryData<ViewState>(queryKey, (old) => {
			const base: ViewState = old ?? { chapterIds: [], keyChangeIds: [], filePaths: [] };
			return patch(base);
		});
		return { previous, queryKey };
	};

	const rollback = (ctx: MutationContext | undefined): void => {
		if (!ctx) return;
		queryClient.setQueryData<ViewState>(ctx.queryKey, ctx.previous);
	};

	const settle = (
		_data: unknown,
		_error: Error | null,
		_vars: string,
		ctx: MutationContext | undefined,
	): void => {
		if (!ctx) return;
		void queryClient.invalidateQueries({ queryKey: ctx.queryKey });
	};

	const markChapterMutation = useMutation<unknown, Error, string, MutationContext>({
		mutationFn: postChapterView,
		onMutate: (chapterId) =>
			snapshotAndPatch((prev) => {
				if (prev.chapterIds.includes(chapterId)) return prev;
				return { ...prev, chapterIds: [...prev.chapterIds, chapterId] };
			}),
		onError: (_err, _chapterId, ctx) => rollback(ctx),
		onSettled: settle,
	});

	const unmarkChapterMutation = useMutation<unknown, Error, string, MutationContext>({
		mutationFn: deleteChapterView,
		onMutate: (chapterId) =>
			snapshotAndPatch((prev) => ({
				...prev,
				chapterIds: prev.chapterIds.filter((id) => id !== chapterId),
			})),
		onError: (_err, _chapterId, ctx) => rollback(ctx),
		onSettled: settle,
	});

	const markKeyChangeMutation = useMutation<unknown, Error, string, MutationContext>({
		mutationFn: postKeyChangeView,
		onMutate: (keyChangeId) =>
			snapshotAndPatch((prev) => {
				if (prev.keyChangeIds.includes(keyChangeId)) return prev;
				return { ...prev, keyChangeIds: [...prev.keyChangeIds, keyChangeId] };
			}),
		onError: (_err, _keyChangeId, ctx) => rollback(ctx),
		onSettled: settle,
	});

	const unmarkKeyChangeMutation = useMutation<unknown, Error, string, MutationContext>({
		mutationFn: deleteKeyChangeView,
		onMutate: (keyChangeId) =>
			snapshotAndPatch((prev) => ({
				...prev,
				keyChangeIds: prev.keyChangeIds.filter((id) => id !== keyChangeId),
			})),
		onError: (_err, _keyChangeId, ctx) => rollback(ctx),
		onSettled: settle,
	});

	const markFileMutation = useMutation<unknown, Error, string, MutationContext>({
		mutationFn: (filePath) => postFileView(runId, filePath),
		onMutate: (filePath) =>
			snapshotAndPatch((prev) => {
				if (prev.filePaths.includes(filePath)) return prev;
				return { ...prev, filePaths: [...prev.filePaths, filePath] };
			}),
		onError: (_err, _filePath, ctx) => rollback(ctx),
		onSettled: settle,
	});

	const unmarkFileMutation = useMutation<unknown, Error, string, MutationContext>({
		mutationFn: (filePath) => deleteFileView(runId, filePath),
		onMutate: (filePath) =>
			snapshotAndPatch((prev) => ({
				...prev,
				filePaths: prev.filePaths.filter((p) => p !== filePath),
			})),
		onError: (_err, _filePath, ctx) => rollback(ctx),
		onSettled: settle,
	});

	return {
		...data,
		markChapterViewed: markChapterMutation.mutate,
		unmarkChapterViewed: unmarkChapterMutation.mutate,
		markKeyChangeChecked: markKeyChangeMutation.mutate,
		unmarkKeyChangeChecked: unmarkKeyChangeMutation.mutate,
		markFileViewed: markFileMutation.mutate,
		unmarkFileViewed: unmarkFileMutation.mutate,
	};
}
