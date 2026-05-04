import { FileViewBodySchema } from "@stagereview/types/view-state";
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
				// External-id fan-out: re-imports of the same diff produce multiple chapter
				// rows sharing one externalId, and view-state must survive across them.
				db.transaction((tx) => {
					tx.insert(chapterView)
						.values(rows.map((r) => ({ userId: LOCAL_USER_ID, chapterId: r.id })))
						.onConflictDoNothing()
						.run();

					// file_view is only promoted once every chapter in the run touching a
					// path has a chapter_file_view row for it — see promoteFullyCoveredFiles.
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

					// Unconditional file_view clear for every path the unmarked chapter
					// touched, even if other chapters still cover the path. A future mark
					// on any covering chapter re-promotes via promoteFullyCoveredFiles.
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
		// File-view endpoints carry the path in the body so `/` separators don't
		// have to be URL-encoded into route segments.
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

				// Direct file mark deliberately doesn't backfill chapter_file_view — the
				// intent is "I've reviewed this file", not "every chapter covers it".
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

				// Cascade to chapter state too, matching hosted's file-unview behavior.
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

					const affectedChapterIds = chaptersContainingFile(tx, runId, parsed.path);
					if (affectedChapterIds.length === 0) return;
					tx.delete(chapterFileView)
						.where(
							and(
								eq(chapterFileView.userId, LOCAL_USER_ID),
								eq(chapterFileView.filePath, parsed.path),
								inArray(chapterFileView.chapterId, affectedChapterIds),
							),
						)
						.run();
					tx.delete(chapterView)
						.where(
							and(
								eq(chapterView.userId, LOCAL_USER_ID),
								inArray(chapterView.chapterId, affectedChapterIds),
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

				// Returning external_id (not the uuid PK) is what makes view-state
				// survive content regenerations.
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

// Looks up by uuid first, falling back to externalId so re-imports of the same
// scope (which share an externalId across chapter rows) all get the cascade.
function resolveChapterRows(db: StageDb, idOrExternalId: string | undefined): ResolvedChapterRow[] {
	if (!idOrExternalId) return [];
	const cols = { id: chapter.id, runId: chapter.runId, hunkRefs: chapter.hunkRefs };
	const byPk = db.select(cols).from(chapter).where(eq(chapter.id, idOrExternalId)).all();
	if (byPk.length > 0) return byPk;
	return db.select(cols).from(chapter).where(eq(chapter.externalId, idOrExternalId)).all();
}

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
 * Promotes file_view for each touched (runId, filePath) iff every chapter in
 * the run whose hunkRefs contain that path has a chapter_file_view row for it.
 */
function promoteFullyCoveredFiles(tx: Tx, touched: RunPath[]): void {
	if (touched.length === 0) return;
	const runIds = Array.from(new Set(touched.map((t) => t.runId)));
	const paths = Array.from(new Set(touched.map((t) => t.filePath)));

	// hunkRefs is JSON-stored, so we filter in JS. Bounded by the chapter count
	// of the affected runs (typically a few dozen).
	const allChapters = tx
		.select({ id: chapter.id, runId: chapter.runId, hunkRefs: chapter.hunkRefs })
		.from(chapter)
		.where(inArray(chapter.runId, runIds))
		.all();

	const containing = countChaptersPerPath(allChapters, runIds, paths);

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

	// `marked` is always a subset of `containing` (chapter_file_view rows are
	// only inserted for files in the chapter's own hunkRefs), so size equality
	// is enough to detect full coverage.
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

function chaptersContainingFile(tx: Tx, runId: string, filePath: string): string[] {
	return tx
		.select({ id: chapter.id, hunkRefs: chapter.hunkRefs })
		.from(chapter)
		.where(eq(chapter.runId, runId))
		.all()
		.filter((row) => row.hunkRefs.some((ref) => ref.filePath === filePath))
		.map((row) => row.id);
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
