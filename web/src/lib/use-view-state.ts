import { useCallback, useRef, useState } from "react";

const STORAGE_PREFIX = "stage-view-state-";
const TTL_MS = 90 * 24 * 60 * 60 * 1000;

interface StoredViewState {
  chapterIds: string[];
  keyChangeIds: string[];
  updatedAt: number;
}

interface ViewState {
  chapterIds: Set<string>;
  keyChangeIds: Set<string>;
}

export interface UseViewStateApi {
  markChapterViewed: (id: string) => void;
  unmarkChapterViewed: (id: string) => void;
  isChapterViewed: (id: string) => boolean;
  markKeyChangeChecked: (id: string) => void;
  unmarkKeyChangeChecked: (id: string) => void;
  isKeyChangeChecked: (id: string) => boolean;
}

function emptyState(): ViewState {
  return { chapterIds: new Set<string>(), keyChangeIds: new Set<string>() };
}

// Bound localStorage growth: each storageKey is per-diff, so a user who runs
// stage-cli on many branches would otherwise accumulate state for SHAs they'll
// never revisit. Sweeping on read is enough — readState runs on mount and on
// key change, both rare. Entries written before updatedAt existed are treated
// as expired so legacy data also gets cleaned up.
function sweepExpired(now: number): void {
  if (typeof window === "undefined") return;
  const keys: string[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
  } catch {
    return;
  }
  for (const key of keys) {
    let updatedAt: unknown;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) continue;
      const parsed: unknown = JSON.parse(raw);
      updatedAt =
        parsed && typeof parsed === "object"
          ? (parsed as { updatedAt?: unknown }).updatedAt
          : undefined;
    } catch {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* noop */
      }
      continue;
    }
    if (typeof updatedAt !== "number" || now - updatedAt > TTL_MS) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* noop */
      }
    }
  }
}

function readState(storageKey: string): ViewState {
  if (typeof window === "undefined") return emptyState();
  sweepExpired(Date.now());
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_PREFIX + storageKey);
  } catch {
    return emptyState();
  }
  if (raw === null) return emptyState();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return emptyState();
    const candidate = parsed as Partial<StoredViewState>;
    return {
      chapterIds: new Set(Array.isArray(candidate.chapterIds) ? candidate.chapterIds : []),
      keyChangeIds: new Set(Array.isArray(candidate.keyChangeIds) ? candidate.keyChangeIds : []),
    };
  } catch {
    return emptyState();
  }
}

function writeState(storageKey: string, state: ViewState): void {
  if (typeof window === "undefined") return;
  const stored: StoredViewState = {
    chapterIds: [...state.chapterIds],
    keyChangeIds: [...state.keyChangeIds],
    updatedAt: Date.now(),
  };
  try {
    window.localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(stored));
  } catch {
    // Storage full or unavailable — keep React state consistent regardless.
  }
}

function withAdded(set: Set<string>, id: string): Set<string> {
  if (set.has(id)) return set;
  const next = new Set(set);
  next.add(id);
  return next;
}

function withRemoved(set: Set<string>, id: string): Set<string> {
  if (!set.has(id)) return set;
  const next = new Set(set);
  next.delete(id);
  return next;
}

export function useViewState(storageKey: string): UseViewStateApi {
  const [state, setState] = useState<ViewState>(() => readState(storageKey));

  // Mirror state in a ref so persist can compute the next value and write to
  // localStorage in the event handler, not inside a setState updater. State
  // updaters must be pure (https://react.dev/learn/keeping-components-pure),
  // and React may invoke them more than once under Strict Mode / concurrent
  // rendering — keeping writeState out of them avoids the redundant writes.
  const stateRef = useRef(state);
  stateRef.current = state;

  // Re-hydrate from localStorage when the storage key changes. Adjusting state
  // during render (https://react.dev/learn/you-might-not-need-an-effect) keeps
  // the new render and any persist call against it in sync — without this,
  // mutations after a key change would write the prior key's state under the
  // new key.
  const lastKeyRef = useRef(storageKey);
  if (lastKeyRef.current !== storageKey) {
    lastKeyRef.current = storageKey;
    const fresh = readState(storageKey);
    stateRef.current = fresh;
    setState(fresh);
  }

  const persist = useCallback(
    (updater: (prev: ViewState) => ViewState) => {
      const prev = stateRef.current;
      const next = updater(prev);
      if (next === prev) return;
      stateRef.current = next;
      setState(next);
      writeState(storageKey, next);
    },
    [storageKey],
  );

  const markChapterViewed = useCallback(
    (id: string) =>
      persist((prev) => {
        const chapterIds = withAdded(prev.chapterIds, id);
        return chapterIds === prev.chapterIds ? prev : { ...prev, chapterIds };
      }),
    [persist],
  );

  const unmarkChapterViewed = useCallback(
    (id: string) =>
      persist((prev) => {
        const chapterIds = withRemoved(prev.chapterIds, id);
        return chapterIds === prev.chapterIds ? prev : { ...prev, chapterIds };
      }),
    [persist],
  );

  const isChapterViewed = useCallback((id: string) => state.chapterIds.has(id), [state.chapterIds]);

  const markKeyChangeChecked = useCallback(
    (id: string) =>
      persist((prev) => {
        const keyChangeIds = withAdded(prev.keyChangeIds, id);
        return keyChangeIds === prev.keyChangeIds ? prev : { ...prev, keyChangeIds };
      }),
    [persist],
  );

  const unmarkKeyChangeChecked = useCallback(
    (id: string) =>
      persist((prev) => {
        const keyChangeIds = withRemoved(prev.keyChangeIds, id);
        return keyChangeIds === prev.keyChangeIds ? prev : { ...prev, keyChangeIds };
      }),
    [persist],
  );

  const isKeyChangeChecked = useCallback(
    (id: string) => state.keyChangeIds.has(id),
    [state.keyChangeIds],
  );

  return {
    markChapterViewed,
    unmarkChapterViewed,
    isChapterViewed,
    markKeyChangeChecked,
    unmarkKeyChangeChecked,
    isKeyChangeChecked,
  };
}
