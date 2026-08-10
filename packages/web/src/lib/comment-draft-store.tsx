import { createContext, type ReactNode, use, useCallback, useMemo, useRef, useState } from "react";
import type { DraftBodies, DraftState } from "@/lib/comment-drafts";

type DraftsUpdater = (prev: readonly DraftState[]) => readonly DraftState[];

interface CommentDraftStoreValue {
	draftsByFile: ReadonlyMap<string, readonly DraftState[]>;
	updateDrafts: (filePath: string, updater: DraftsUpdater) => void;
	getDraftBodies: (filePath: string) => DraftBodies;
}

const CommentDraftStoreContext = createContext<CommentDraftStoreValue | null>(null);

const NO_DRAFTS: readonly DraftState[] = [];

/**
 * Holds in-progress comment composers — their open anchors and typed text —
 * above the virtualized file lists, keyed by file path. Virtuoso unmounts a
 * file's row once it scrolls beyond the overscan window, so drafts kept inside
 * the diff viewer would be lost; keeping them here means an unsent comment
 * survives that unmount and rehydrates when the row remounts.
 */
export function CommentDraftStoreProvider({
	resetKey,
	children,
}: {
	/** Clears every draft when it changes (navigating to a different run). */
	resetKey: string;
	children: ReactNode;
}) {
	const [draftsByFile, setDraftsByFile] = useState<ReadonlyMap<string, readonly DraftState[]>>(
		new Map(),
	);
	// Composer text lives outside React state so typing never re-renders the
	// diff tree (see DraftBodies) — one bodies map per file, created lazily.
	const bodiesByFileRef = useRef(new Map<string, DraftBodies>());

	const prevResetKey = useRef(resetKey);
	if (prevResetKey.current !== resetKey) {
		prevResetKey.current = resetKey;
		setDraftsByFile(new Map());
		bodiesByFileRef.current = new Map();
	}

	const updateDrafts = useCallback((filePath: string, updater: DraftsUpdater) => {
		setDraftsByFile((prev) => {
			const current = prev.get(filePath) ?? NO_DRAFTS;
			const updated = updater(current);
			if (updated === current) return prev;
			const next = new Map(prev);
			if (updated.length === 0) {
				next.delete(filePath);
			} else {
				next.set(filePath, updated);
			}
			return next;
		});
	}, []);

	const getDraftBodies = useCallback((filePath: string): DraftBodies => {
		let bodies = bodiesByFileRef.current.get(filePath);
		if (!bodies) {
			bodies = new Map();
			bodiesByFileRef.current.set(filePath, bodies);
		}
		return bodies;
	}, []);

	const value = useMemo(
		() => ({ draftsByFile, updateDrafts, getDraftBodies }),
		[draftsByFile, updateDrafts, getDraftBodies],
	);

	return <CommentDraftStoreContext value={value}>{children}</CommentDraftStoreContext>;
}

export interface FileCommentDrafts {
	drafts: readonly DraftState[];
	setDrafts: (updater: DraftsUpdater) => void;
	draftBodies: DraftBodies;
}

/**
 * A single file's slice of the draft store. Viewers without a file path (raw
 * patch mode) have no durable key to store drafts under, so theirs stay local
 * to the mounted viewer instance — the pre-store behavior.
 */
export function useFileCommentDrafts(filePath: string | undefined): FileCommentDrafts {
	const store = use(CommentDraftStoreContext);
	if (!store) {
		throw new Error("useFileCommentDrafts must be used within a CommentDraftStoreProvider");
	}

	const [localDrafts, setLocalDrafts] = useState<readonly DraftState[]>(NO_DRAFTS);
	const localBodiesRef = useRef<DraftBodies>(new Map());
	const setDrafts = useCallback(
		(updater: DraftsUpdater) => {
			if (filePath === undefined) {
				setLocalDrafts(updater);
			} else {
				store.updateDrafts(filePath, updater);
			}
		},
		[store, filePath],
	);

	if (filePath === undefined) {
		return { drafts: localDrafts, setDrafts, draftBodies: localBodiesRef.current };
	}
	return {
		drafts: store.draftsByFile.get(filePath) ?? NO_DRAFTS,
		setDrafts,
		draftBodies: store.getDraftBodies(filePath),
	};
}
