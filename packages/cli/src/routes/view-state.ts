import { FileViewBodySchema } from "@stage-cli/types/view-state";
import { and, eq, inArray } from "drizzle-orm";
import type { StageDb } from "../db/client.js";
import { LOCAL_USER_ID } from "../db/local-user.js";
import {
	chapter,
	chapterFileView,
	chapterRun,
	chapterView,
	fileView,
	keyChange,
	keyChangeView,
} from "../db/schema/index.js";
import type { Route } from "../server.js";
import { readJsonBody, writeJson } from "./json.js";

type Tx = Parameters<Parameters<StageDb["transaction"]>[0]>[0];

export function viewStateRoutes(db: StageDb): Route[] {
	return [
		{
			method: "POST",
			pattern: "/api/chapter-view/:chapterId",
			handler: (_req, res, params) => {
				const rows = resolveChapterRows(db, params.chapterId);
				if (rows.length === 0) {
					writeJson(res, 404, { error: `Chapter ${params.chapterId} not found` });
					return;
				}
				// Fan out across every chapter row sharing this externalId so view-state survives
				// re-imports of the same diff (PLA-117). For a uuid param this collapses to one row.
				db.transaction((tx) => {
					tx.insert(chapterView)
						.values(rows.map((r) => ({ userId: LOCAL_USER_ID, chapterId: r.id })))
						.onConflictDoNothing()
						.run();

					// Per-chapter mark: one chapter_file_view row per (chapter, file). The
					// global file_view row is only set further down once *every* chapter in
					// the run that touches that path has a row here — mirrors hosted's "all
					// chapters covered → file is viewed" rule.
					const cfvInserts = chapterFileViewInserts(rows);
					if (cfvInserts.length === 0) {
						writeJson(res, 200, {});
						return;
					}
					tx.insert(chapterFileView).values(cfvInserts).onConflictDoNothing().run();

					promoteFullyCoveredFiles(tx, touchedRunPaths(rows));
				});
				writeJson(res, 200, {});
			},
		},
		{
			method: "DELETE",
			pattern: "/api/chapter-view/:chapterId",
			handler: (_req, res, params) => {
				const rows = resolveChapterRows(db, params.chapterId);
				if (rows.length === 0) {
					// Idempotent: if the chapter doesn't exist there's nothing to delete. The SPA
					// shouldn't have to distinguish "row was gone" from "chapter was gone".
					writeJson(res, 200, {});
					return;
				}
				db.transaction((tx) => {
					const chapterIds = rows.map((r) => r.id);
					tx.delete(chapterView)
						.where(
							and(
								eq(chapterView.userId, LOCAL_USER_ID),
								inArray(chapterView.chapterId, chapterIds),
							),
						)
						.run();
					tx.delete(chapterFileView)
						.where(
							and(
								eq(chapterFileView.userId, LOCAL_USER_ID),
								inArray(chapterFileView.chapterId, chapterIds),
							),
						)
						.run();

					// "Any chapter unmarked → unmark the files in that chapter" — clears the
					// global file_view row for every path the unmarked chapter touched, even
					// if other chapters still have chapter_file_view rows for it. Mirrors
					// hosted's rule 4. The next chapter mark on a covering chapter will
					// re-promote it via promoteFullyCoveredFiles.
					const touched = touchedRunPaths(rows);
					if (touched.length === 0) return;
					const runIds = Array.from(new Set(touched.map((t) => t.runId)));
					const filePaths = Array.from(new Set(touched.map((t) => t.filePath)));
					tx.delete(fileView)
						.where(
							and(
								eq(fileView.userId, LOCAL_USER_ID),
								inArray(fileView.runId, runIds),
								inArray(fileView.filePath, filePaths),
							),
						)
						.run();
				});
				writeJson(res, 200, {});
			},
		},
		{
			method: "POST",
			pattern: "/api/key-change-view/:keyChangeId",
			handler: (_req, res, params) => {
				const ids = resolveKeyChangeIds(db, params.keyChangeId);
				if (ids.length === 0) {
					writeJson(res, 404, { error: `Key change ${params.keyChangeId} not found` });
					return;
				}
				db.insert(keyChangeView)
					.values(ids.map((id) => ({ userId: LOCAL_USER_ID, keyChangeId: id })))
					.onConflictDoNothing()
					.run();
				writeJson(res, 200, {});
			},
		},
		{
			method: "DELETE",
			pattern: "/api/key-change-view/:keyChangeId",
			handler: (_req, res, params) => {
				const ids = resolveKeyChangeIds(db, params.keyChangeId);
				if (ids.length === 0) {
					writeJson(res, 200, {});
					return;
				}
				db.delete(keyChangeView)
					.where(
						and(eq(keyChangeView.userId, LOCAL_USER_ID), inArray(keyChangeView.keyChangeId, ids)),
					)
					.run();
				writeJson(res, 200, {});
			},
		},
		// File-view endpoints take the path in the body so file paths with `/` separators
		// don't have to be URL-encoded into route segments.
		{
			method: "POST",
			pattern: "/api/runs/:runId/file-views",
			handler: async (req, res, params) => {
				const runId = params.runId;
				if (!runId) {
					writeJson(res, 400, { error: "Missing runId" });
					return;
				}
				if (!runExists(db, runId)) {
					writeJson(res, 404, { error: `Run ${runId} not found` });
					return;
				}

				const parsed = await parseFileViewBody(req, res);
				if (!parsed) return;

				// Direct mark from the Files tab: only writes file_view. We deliberately
				// don't backfill chapter_file_view — the user's intent is "I've reviewed
				// this file globally", not "this file is covered by every chapter".
				db.insert(fileView)
					.values({ userId: LOCAL_USER_ID, runId, filePath: parsed.path })
					.onConflictDoNothing()
					.run();
				writeJson(res, 200, {});
			},
		},
		{
			method: "DELETE",
			pattern: "/api/runs/:runId/file-views",
			handler: async (req, res, params) => {
				const runId = params.runId;
				if (!runId) {
					writeJson(res, 400, { error: "Missing runId" });
					return;
				}
				if (!runExists(db, runId)) {
					writeJson(res, 200, {});
					return;
				}

				const parsed = await parseFileViewBody(req, res);
				if (!parsed) return;

				// Cascade direct file unmark across every chapter in this run that's
				// marked the same file — without this, a chapter mark/unmark cycle
				// after the unmark would resurrect file_view via the coverage rule.
				// Mirrors hosted's per-file unmark cascade.
				db.transaction((tx) => {
					tx.delete(fileView)
						.where(
							and(
								eq(fileView.userId, LOCAL_USER_ID),
								eq(fileView.runId, runId),
								eq(fileView.filePath, parsed.path),
							),
						)
						.run();

					const chapterIds = tx
						.select({ id: chapter.id })
						.from(chapter)
						.where(eq(chapter.runId, runId))
						.all()
						.map((r) => r.id);
					if (chapterIds.length === 0) return;
					tx.delete(chapterFileView)
						.where(
							and(
								eq(chapterFileView.userId, LOCAL_USER_ID),
								eq(chapterFileView.filePath, parsed.path),
								inArray(chapterFileView.chapterId, chapterIds),
							),
						)
						.run();
				});
				writeJson(res, 200, {});
			},
		},
		{
			method: "GET",
			pattern: "/api/runs/:runId/view-state",
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

				// Returning external_id (not the uuid PK) is what makes view-state survive content
				// regenerations — see PLA-116 for the externalId derivation.
				const viewedChapters = db
					.select({ externalId: chapter.externalId })
					.from(chapterView)
					.innerJoin(chapter, eq(chapter.id, chapterView.chapterId))
					.where(and(eq(chapterView.userId, LOCAL_USER_ID), eq(chapter.runId, runId)))
					.all();

				const checkedKeyChanges = db
					.select({ externalId: keyChange.externalId })
					.from(keyChangeView)
					.innerJoin(keyChange, eq(keyChange.id, keyChangeView.keyChangeId))
					.innerJoin(chapter, eq(chapter.id, keyChange.chapterId))
					.where(and(eq(keyChangeView.userId, LOCAL_USER_ID), eq(chapter.runId, runId)))
					.all();

				const viewedFiles = db
					.select({ filePath: fileView.filePath })
					.from(fileView)
					.where(and(eq(fileView.userId, LOCAL_USER_ID), eq(fileView.runId, runId)))
					.all();

				writeJson(res, 200, {
					chapterIds: viewedChapters.map((r) => r.externalId),
					keyChangeIds: checkedKeyChanges.map((r) => r.externalId),
					filePaths: viewedFiles.map((r) => r.filePath),
				});
			},
		},
	];
}

interface ResolvedChapterRow {
	id: string;
	runId: string;
	hunkRefs: typeof chapter.$inferSelect.hunkRefs;
}

// Returns every chapter row matching the param: a singleton when given a uuid, or every
// chapter sharing an externalId (re-imports of the same scope). Empty array means 404.
function resolveChapterRows(db: StageDb, idOrExternalId: string | undefined): ResolvedChapterRow[] {
	if (!idOrExternalId) return [];
	const cols = { id: chapter.id, runId: chapter.runId, hunkRefs: chapter.hunkRefs };
	const byPk = db.select(cols).from(chapter).where(eq(chapter.id, idOrExternalId)).all();
	if (byPk.length > 0) return byPk;
	return db.select(cols).from(chapter).where(eq(chapter.externalId, idOrExternalId)).all();
}

// One chapter_file_view row per (chapter, distinct hunkRef path).
function chapterFileViewInserts(
	rows: ResolvedChapterRow[],
): Array<{ userId: string; chapterId: string; filePath: string }> {
	const out: Array<{ userId: string; chapterId: string; filePath: string }> = [];
	for (const row of rows) {
		const seen = new Set<string>();
		for (const ref of row.hunkRefs) {
			if (seen.has(ref.filePath)) continue;
			seen.add(ref.filePath);
			out.push({ userId: LOCAL_USER_ID, chapterId: row.id, filePath: ref.filePath });
		}
	}
	return out;
}

interface RunPath {
	runId: string;
	filePath: string;
}

// Distinct (runId, filePath) pairs touched by the affected chapters' hunkRefs.
// Used as the input set for both promotion (POST) and unmarking (DELETE).
function touchedRunPaths(rows: ResolvedChapterRow[]): RunPath[] {
	const seen = new Set<string>();
	const out: RunPath[] = [];
	for (const row of rows) {
		for (const ref of row.hunkRefs) {
			const key = `${row.runId} ${ref.filePath}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push({ runId: row.runId, filePath: ref.filePath });
		}
	}
	return out;
}

/**
 * For each (runId, filePath) just touched by a chapter mark, promote the file
 * to globally-viewed (insert into file_view) iff every chapter in the run
 * whose hunkRefs contain that path has a chapter_file_view row for it.
 *
 * Two queries: one to count "containing" chapters per (runId, filePath),
 * one to count "marked" chapters. When the counts match (and are non-zero),
 * the file is fully covered.
 */
function promoteFullyCoveredFiles(tx: Tx, touched: RunPath[]): void {
	if (touched.length === 0) return;
	const runIds = Array.from(new Set(touched.map((t) => t.runId)));
	const paths = Array.from(new Set(touched.map((t) => t.filePath)));

	// "Containing" chapters: count chapters in the affected runs whose hunkRefs
	// reference each path. hunkRefs is JSON, so we do the filter in JS — bounded
	// by the chapter count of the affected runs (typically a few dozen).
	const allChapters = tx
		.select({ id: chapter.id, runId: chapter.runId, hunkRefs: chapter.hunkRefs })
		.from(chapter)
		.where(inArray(chapter.runId, runIds))
		.all();

	const containing = countChaptersPerPath(allChapters, runIds, paths);

	// "Marked" chapters: chapter_file_view rows joined back to chapter to recover runId.
	const markedRows = tx
		.select({
			chapterId: chapterFileView.chapterId,
			runId: chapter.runId,
			filePath: chapterFileView.filePath,
		})
		.from(chapterFileView)
		.innerJoin(chapter, eq(chapter.id, chapterFileView.chapterId))
		.where(
			and(
				eq(chapterFileView.userId, LOCAL_USER_ID),
				inArray(chapter.runId, runIds),
				inArray(chapterFileView.filePath, paths),
			),
		)
		.all();
	const marked = countChaptersFromRows(markedRows);

	// Promote where containing == marked (and > 0). marked is always a subset of
	// containing because chapter_file_view rows are only inserted for the chapter's
	// own hunkRefs, so the equality check is sufficient.
	const inserts: Array<{ userId: string; runId: string; filePath: string }> = [];
	for (const t of touched) {
		const have = marked.get(t.runId)?.get(t.filePath) ?? 0;
		const need = containing.get(t.runId)?.get(t.filePath) ?? 0;
		if (need > 0 && have === need) {
			inserts.push({ userId: LOCAL_USER_ID, runId: t.runId, filePath: t.filePath });
		}
	}
	if (inserts.length > 0) {
		tx.insert(fileView).values(inserts).onConflictDoNothing().run();
	}
}

type CountMap = Map<string, Map<string, number>>;

function bumpCount(map: CountMap, runId: string, filePath: string): void {
	let inner = map.get(runId);
	if (!inner) {
		inner = new Map();
		map.set(runId, inner);
	}
	inner.set(filePath, (inner.get(filePath) ?? 0) + 1);
}

function countChaptersPerPath(
	rows: Array<{ id: string; runId: string; hunkRefs: ResolvedChapterRow["hunkRefs"] }>,
	runIds: string[],
	paths: string[],
): CountMap {
	const runIdSet = new Set(runIds);
	const pathSet = new Set(paths);
	const out: CountMap = new Map();
	for (const row of rows) {
		if (!runIdSet.has(row.runId)) continue;
		const seen = new Set<string>();
		for (const ref of row.hunkRefs) {
			if (!pathSet.has(ref.filePath) || seen.has(ref.filePath)) continue;
			seen.add(ref.filePath);
			bumpCount(out, row.runId, ref.filePath);
		}
	}
	return out;
}

function countChaptersFromRows(
	rows: Array<{ chapterId: string; runId: string; filePath: string }>,
): CountMap {
	const out: CountMap = new Map();
	for (const row of rows) bumpCount(out, row.runId, row.filePath);
	return out;
}

function resolveKeyChangeIds(db: StageDb, idOrExternalId: string | undefined): string[] {
	if (!idOrExternalId) return [];
	const byPk = db
		.select({ id: keyChange.id })
		.from(keyChange)
		.where(eq(keyChange.id, idOrExternalId))
		.all();
	if (byPk.length > 0) return byPk.map((r) => r.id);
	return db
		.select({ id: keyChange.id })
		.from(keyChange)
		.where(eq(keyChange.externalId, idOrExternalId))
		.all()
		.map((r) => r.id);
}

function runExists(db: StageDb, runId: string): boolean {
	const rows = db
		.select({ id: chapterRun.id })
		.from(chapterRun)
		.where(eq(chapterRun.id, runId))
		.limit(1)
		.all();
	return rows.length > 0;
}

async function parseFileViewBody(
	req: Parameters<Route["handler"]>[0],
	res: Parameters<Route["handler"]>[1],
): Promise<{ path: string } | null> {
	let raw: unknown;
	try {
		raw = await readJsonBody(req);
	} catch (err) {
		writeJson(res, 400, { error: err instanceof Error ? err.message : "Invalid JSON body" });
		return null;
	}
	const parsed = FileViewBodySchema.safeParse(raw);
	if (!parsed.success) {
		writeJson(res, 400, { error: "Invalid file-view body: missing or empty `path`" });
		return null;
	}
	return parsed.data;
}
