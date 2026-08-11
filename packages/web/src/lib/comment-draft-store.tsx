import {
	createContext,
	type ReactNode,
	use,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { DraftBodies, DraftState } from "@/lib/comment-drafts";

type DraftsUpdater = (prev: readonly DraftState[]) => readonly DraftState[];

interface CommentDraftStoreValue {
	generation: number;
	draftsByFile: ReadonlyMap<string, readonly DraftState[]>;
	updateDrafts: (generation: number, filePath: string, updater: DraftsUpdater) => void;
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
	// Drafts and the reset generation live in one state object so the stale-write
	// guard below reads them atomically inside the functional updater.
	const [drafts, setDraftsState] = useState<{
		generation: number;
		byFile: ReadonlyMap<string, readonly DraftState[]>;
	}>({ generation: 0, byFile: new Map() });
	// Composer text lives outside React state so typing never re-renders the
	// diff tree (see DraftBodies) — one bodies map per file, created lazily.
	// Nested under a generation counter that bumps on every committed reset,
	// so a revisited run gets a FRESH generation and can never resurrect text
	// discarded with an earlier reset. Lazy idempotent inserts are the only
	// render-time mutation, safe to repeat if a concurrent render is discarded.
	const bodiesByGenerationRef = useRef(new Map<number, Map<string, DraftBodies>>());
	const generation = drafts.generation;

	// React's "adjust state during render" pattern: the previous key lives in
	// state, not a ref — a ref mutated mid-render leaks when a concurrent
	// render is discarded, clearing drafts for the wrong run.
	const [prevResetKey, setPrevResetKey] = useState(resetKey);
	if (prevResetKey !== resetKey) {
		setPrevResetKey(resetKey);
		setDraftsState((current) => ({ generation: current.generation + 1, byFile: new Map() }));
	}

	// A comment submission awaits the network and then closes its draft or attaches
	// an error. The provider stays mounted across stack navigation, so a completion
	// that settles after the run switched must not land in the new run's map — each
	// write carries the generation its caller rendered with and no-ops once a reset
	// has superseded it.
	const updateDrafts = useCallback(
		(callerGeneration: number, filePath: string, updater: DraftsUpdater) => {
			setDraftsState((prev) => {
				if (prev.generation !== callerGeneration) return prev;
				const current = prev.byFile.get(filePath) ?? NO_DRAFTS;
				const updated = updater(current);
				if (updated === current) return prev;
				const next = new Map(prev.byFile);
				if (updated.length === 0) {
					next.delete(filePath);
				} else {
					next.set(filePath, updated);
				}
				return { generation: prev.generation, byFile: next };
			});
		},
		[],
	);

	const getDraftBodies = useCallback(
		(filePath: string): DraftBodies => {
			let byFile = bodiesByGenerationRef.current.get(generation);
			if (!byFile) {
				byFile = new Map();
				bodiesByGenerationRef.current.set(generation, byFile);
			}
			let bodies = byFile.get(filePath);
			if (!bodies) {
				bodies = new Map();
				byFile.set(filePath, bodies);
			}
			return bodies;
		},
		[generation],
	);

	// Post-commit cleanup (never during render, where a discarded concurrent
	// render could wipe the committed generation's text): superseded
	// generations are unreachable — drop them so long sessions hopping
	// between runs don't accumulate dead text.
	useEffect(() => {
		for (const staleGeneration of bodiesByGenerationRef.current.keys()) {
			if (staleGeneration !== generation) bodiesByGenerationRef.current.delete(staleGeneration);
		}
	}, [generation]);

	const value = useMemo(
		() => ({ generation, draftsByFile: drafts.byFile, updateDrafts, getDraftBodies }),
		[generation, drafts.byFile, updateDrafts, getDraftBodies],
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
	// Bind the generation this consumer rendered with: a callback captured before
	// a run switch writes against the old generation and is dropped by the store.
	const setDrafts = useCallback(
		(updater: DraftsUpdater) => {
			if (filePath === undefined) {
				setLocalDrafts(updater);
			} else {
				store.updateDrafts(store.generation, filePath, updater);
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
