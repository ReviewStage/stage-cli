import { Checkbox } from "@/components/ui/checkbox";
import type { Chapter, ChaptersFile } from "@stage/types";
import { type UseViewStateApi, useViewState } from "@/lib/use-view-state";
import { cn } from "@/lib/utils";
import { Circle, CircleCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ChaptersFile };

async function fetchChapters(): Promise<ChaptersFile> {
  const res = await fetch("/api/data.json");
  if (!res.ok) {
    throw new Error(`Failed to fetch /api/data.json: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as ChaptersFile;
}

export function App() {
  const [state, setState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void fetchChapters().then(
      (data) => {
        if (!cancelled) setState({ status: "ready", data });
      },
      (err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ status: "error", message });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <p className="text-muted-foreground text-sm">Loading chapters…</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="max-w-md space-y-2 text-center">
          <h1 className="font-semibold text-base">Could not load chapters</h1>
          <p className="break-words text-muted-foreground text-sm">{state.message}</p>
        </div>
      </div>
    );
  }

  return <ChaptersView file={state.data} />;
}

function ChaptersView({ file }: { file: ChaptersFile }) {
  const view = useViewState(file.scope.headSha);
  const sortedChapters = useMemo(
    () => [...file.chapters].sort((a, b) => a.order - b.order),
    [file.chapters],
  );

  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="space-y-1">
          <h1 className="font-semibold text-2xl">Chapters</h1>
          <p className="text-muted-foreground text-xs">
            {sortedChapters.length} chapter{sortedChapters.length === 1 ? "" : "s"} ·{" "}
            <span className="font-mono">{file.scope.headSha.slice(0, 7)}</span>
          </p>
        </header>
        {sortedChapters.length === 0 ? (
          <p className="text-muted-foreground text-sm">No chapters in this file.</p>
        ) : (
          <ol className="space-y-4">
            {sortedChapters.map((chapter, index) => (
              <ChapterCard key={chapter.id} chapter={chapter} index={index} view={view} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

interface ChapterCardProps {
  chapter: Chapter;
  index: number;
  view: UseViewStateApi;
}

function uniqueFilePaths(chapter: Chapter): string[] {
  const seen = new Set<string>();
  for (const ref of chapter.hunkRefs) {
    seen.add(ref.filePath);
  }
  return [...seen];
}

function ChapterCard({ chapter, index, view }: ChapterCardProps) {
  const isViewed = view.isChapterViewed(chapter.id);
  const filePaths = useMemo(() => uniqueFilePaths(chapter), [chapter]);

  return (
    <li
      className={cn(
        "rounded-lg border border-border bg-card p-4 transition-opacity",
        isViewed && "opacity-70",
      )}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() =>
            isViewed ? view.unmarkChapterViewed(chapter.id) : view.markChapterViewed(chapter.id)
          }
          aria-label={isViewed ? "Mark chapter as unviewed" : "Mark chapter as viewed"}
          aria-pressed={isViewed}
          className={cn(
            "mt-0.5 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent",
            isViewed
              ? "text-green-600 hover:text-green-700 dark:text-green-500 dark:hover:text-green-400"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {isViewed ? <CircleCheck className="size-5" /> : <Circle className="size-5" />}
        </button>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="font-medium text-muted-foreground text-xs">Chapter {index + 1}</p>
            <h2 className="font-semibold text-base leading-snug">{chapter.title}</h2>
          </div>
          <p className="whitespace-pre-wrap text-muted-foreground text-sm">{chapter.summary}</p>
          {chapter.keyChanges.length > 0 && <KeyChangesList chapter={chapter} view={view} />}
          {filePaths.length > 0 && <FileList filePaths={filePaths} />}
        </div>
      </div>
    </li>
  );
}

function keyChangeId(chapterId: string, index: number): string {
  return `${chapterId}-kc-${index}`;
}

function KeyChangesList({ chapter, view }: { chapter: Chapter; view: UseViewStateApi }) {
  return (
    <div>
      <h3 className="mb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
        What to Review
      </h3>
      <ul className="space-y-2">
        {chapter.keyChanges.map((kc, kcIndex) => {
          const id = keyChangeId(chapter.id, kcIndex);
          const checked = view.isKeyChangeChecked(id);
          return (
            <li key={id} className="flex items-start gap-2.5">
              <Checkbox
                checked={checked}
                onCheckedChange={(next) => {
                  if (next === true) view.markKeyChangeChecked(id);
                  else view.unmarkKeyChangeChecked(id);
                }}
                className="mt-0.5"
                aria-label="Mark key change as reviewed"
              />
              <span
                className={cn(
                  "text-muted-foreground text-sm",
                  checked && "text-muted-foreground/60 line-through",
                )}
              >
                {kc.content}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FileList({ filePaths }: { filePaths: string[] }) {
  return (
    <div>
      <h3 className="mb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
        Files
      </h3>
      <ul className="space-y-1 font-mono text-foreground text-xs">
        {filePaths.map((path) => (
          <li key={path} className="truncate">
            {path}
          </li>
        ))}
      </ul>
    </div>
  );
}
