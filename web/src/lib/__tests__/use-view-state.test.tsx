// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useViewState } from "../use-view-state";

const STORAGE_PREFIX = "stage-view-state-";

describe("useViewState", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("starts empty when localStorage has no entry for the key", () => {
    const { result } = renderHook(() => useViewState("repo-a"));
    expect(result.current.isChapterViewed("ch-1")).toBe(false);
    expect(result.current.isKeyChangeChecked("ch-1-kc-0")).toBe(false);
  });

  it("marks and unmarks a chapter as viewed", () => {
    const { result } = renderHook(() => useViewState("repo-a"));

    act(() => result.current.markChapterViewed("ch-1"));
    expect(result.current.isChapterViewed("ch-1")).toBe(true);
    expect(result.current.isChapterViewed("ch-2")).toBe(false);

    act(() => result.current.unmarkChapterViewed("ch-1"));
    expect(result.current.isChapterViewed("ch-1")).toBe(false);
  });

  it("marks and unmarks a key change as checked", () => {
    const { result } = renderHook(() => useViewState("repo-a"));

    act(() => result.current.markKeyChangeChecked("ch-1-kc-0"));
    expect(result.current.isKeyChangeChecked("ch-1-kc-0")).toBe(true);

    act(() => result.current.unmarkKeyChangeChecked("ch-1-kc-0"));
    expect(result.current.isKeyChangeChecked("ch-1-kc-0")).toBe(false);
  });

  it("persists viewed chapters across hook re-mount", () => {
    const first = renderHook(() => useViewState("repo-a"));
    act(() => first.result.current.markChapterViewed("ch-1"));
    first.unmount();

    const second = renderHook(() => useViewState("repo-a"));
    expect(second.result.current.isChapterViewed("ch-1")).toBe(true);
    expect(second.result.current.isChapterViewed("ch-2")).toBe(false);
  });

  it("persists checked key changes across hook re-mount", () => {
    const first = renderHook(() => useViewState("repo-a"));
    act(() => first.result.current.markKeyChangeChecked("ch-1-kc-0"));
    first.unmount();

    const second = renderHook(() => useViewState("repo-a"));
    expect(second.result.current.isKeyChangeChecked("ch-1-kc-0")).toBe(true);
  });

  it("isolates state per storage key", () => {
    const a = renderHook(() => useViewState("repo-a"));
    const b = renderHook(() => useViewState("repo-b"));

    act(() => a.result.current.markChapterViewed("ch-1"));

    expect(a.result.current.isChapterViewed("ch-1")).toBe(true);
    expect(b.result.current.isChapterViewed("ch-1")).toBe(false);
  });

  it("writes both chapter and key change ids to a single storage entry", () => {
    const { result } = renderHook(() => useViewState("repo-a"));
    act(() => {
      result.current.markChapterViewed("ch-1");
      result.current.markKeyChangeChecked("ch-1-kc-0");
    });

    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}repo-a`);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw ?? "");
    expect(parsed).toEqual({
      chapterIds: ["ch-1"],
      keyChangeIds: ["ch-1-kc-0"],
    });
  });

  it("treats a corrupt storage entry as empty without throwing", () => {
    window.localStorage.setItem(`${STORAGE_PREFIX}repo-a`, "{not json");

    const { result } = renderHook(() => useViewState("repo-a"));
    expect(result.current.isChapterViewed("ch-1")).toBe(false);

    act(() => result.current.markChapterViewed("ch-1"));
    expect(result.current.isChapterViewed("ch-1")).toBe(true);
  });

  it("is a no-op when marking an already-viewed chapter", () => {
    const { result } = renderHook(() => useViewState("repo-a"));
    act(() => result.current.markChapterViewed("ch-1"));
    act(() => result.current.markChapterViewed("ch-1"));

    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}repo-a`);
    const parsed = JSON.parse(raw ?? "");
    expect(parsed.chapterIds).toEqual(["ch-1"]);
  });
});
