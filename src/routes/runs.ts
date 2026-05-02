import { asc, eq, inArray } from "drizzle-orm";
import type { StageDb } from "../db/client.js";
import { chapter, chapterRun, keyChange } from "../db/schema/index.js";
import type { Route } from "../server.js";

export function runRoutes(db: StageDb): Route[] {
  return [
    {
      method: "GET",
      pattern: "/api/runs/:runId/chapters",
      handler: (_req, res, params) => {
        const runId = params.runId;
        if (!runId) {
          writeJson(res, 400, { error: "Missing runId" });
          return;
        }

        const [run] = db.select().from(chapterRun).where(eq(chapterRun.id, runId)).limit(1).all();
        if (!run) {
          writeJson(res, 404, { error: `Run ${runId} not found` });
          return;
        }

        const chapters = db
          .select()
          .from(chapter)
          .where(eq(chapter.runId, runId))
          .orderBy(asc(chapter.chapterIndex))
          .all();

        const chapterIds = chapters.map((c) => c.id);
        const keyChanges =
          chapterIds.length > 0
            ? db.select().from(keyChange).where(inArray(keyChange.chapterId, chapterIds)).all()
            : [];

        const byChapter = new Map<string, typeof keyChanges>();
        for (const kc of keyChanges) {
          const list = byChapter.get(kc.chapterId);
          if (list) list.push(kc);
          else byChapter.set(kc.chapterId, [kc]);
        }

        // Drop the denormalized `keyChanges` content array from the chapter row — the API
        // surface returns full key_change rows under the same key. Keeping both would let
        // them drift.
        const nested = chapters.map(({ keyChanges: _denormalized, ...rest }) => ({
          ...rest,
          keyChanges: byChapter.get(rest.id) ?? [],
        }));

        writeJson(res, 200, { run, chapters: nested });
      },
    },
  ];
}

function writeJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
