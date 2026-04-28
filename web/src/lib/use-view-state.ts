import { useCallback, useState } from "react";

const STORAGE_PREFIX = "stage-view-state-";

interface StoredViewState {
  chapterIds: string[];
  keyChangeIds: string[];
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

function readState(storageKey: string): ViewState {
  if (typeof window === "undefined") return emptyState();
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

  const persist = useCallback(
    (updater: (prev: ViewState) => ViewState) => {
      setState((prev) => {
        const next = updater(prev);
        if (next === prev) return prev;
        writeState(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  const markChapterViewed = useCallback(
    (id: string) => persist((prev) => ({ ...prev, chapterIds: withAdded(prev.chapterIds, id) })),
    [persist],
  );

  const unmarkChapterViewed = useCallback(
    (id: string) => persist((prev) => ({ ...prev, chapterIds: withRemoved(prev.chapterIds, id) })),
    [persist],
  );

  const isChapterViewed = useCallback((id: string) => state.chapterIds.has(id), [state.chapterIds]);

  const markKeyChangeChecked = useCallback(
    (id: string) =>
      persist((prev) => ({ ...prev, keyChangeIds: withAdded(prev.keyChangeIds, id) })),
    [persist],
  );

  const unmarkKeyChangeChecked = useCallback(
    (id: string) =>
      persist((prev) => ({ ...prev, keyChangeIds: withRemoved(prev.keyChangeIds, id) })),
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
