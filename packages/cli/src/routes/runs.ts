import path from "node:path";
import type { Chapter, ChapterRun, KeyChange } from "@stage-cli/types/chapters";
import { asc, eq, inArray } from "drizzle-orm";
import type { StageDb } from "../db/client.js";
import { chapter, chapterRun, keyChange } from "../db/schema/index.js";
import type { Route } from "../server.js";
import { writeJson } from "./json.js";

type ChapterRow = typeof chapter.$inferSelect;
type ChapterRunRow = typeof chapterRun.$inferSelect;
type KeyChangeRow = typeof keyChange.$inferSelect;

// Project DB rows into the public wire shape. Keeps DB-only fields
// (`runId`, `chapterIndex`, `createdAt`, `updatedAt`, the denormalized
// `keyChanges` string array) out of the API surface so the wire format can
// evolve independently of the schema. Mirrors hosted's mapChapterRow pattern.
function mapKeyChange(kc: KeyChangeRow): KeyChange {
	return {
		id: kc.id,
		externalId: kc.externalId,
		content: kc.content,
		lineRefs: kc.lineRefs,
	};
}

function mapChapter(ch: ChapterRow, kcs: KeyChangeRow[]): Chapter {
	return {
		id: ch.id,
		externalId: ch.externalId,
		order: ch.chapterIndex,
		title: ch.title,
		summary: ch.summary,
		hunkRefs: ch.hunkRefs,
		keyChanges: kcs.map(mapKeyChange),
	};
}

function mapRun(run: ChapterRunRow): ChapterRun {
	return { id: run.id, repoName: path.basename(run.repoRoot) };
}

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

				const byChapter = new Map<string, KeyChangeRow[]>();
				for (const kc of keyChanges) {
					const list = byChapter.get(kc.chapterId);
					if (list) list.push(kc);
					else byChapter.set(kc.chapterId, [kc]);
				}

				writeJson(res, 200, {
					run: mapRun(run),
					chapters: chapters.map((ch) => mapChapter(ch, byChapter.get(ch.id) ?? [])),
				});
			},
		},
	];
}
