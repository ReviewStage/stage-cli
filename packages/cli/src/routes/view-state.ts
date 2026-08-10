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
import {
	FILE_VIEWED_STATE,
	type GitHubRepo,
	getPullRequestIdentity,
	getPullRequestOrThrow,
	getViewedFiles,
	markFileAsViewed,
	parseGitHubRepo,
	unmarkFileAsViewed,
} from "../github/index.js";
import { SCOPE_KIND, type ScopeKind } from "../schema.js";
import type { Route } from "../server.js";
import { parseJsonBody, writeJson } from "./json.js";
import { enforceSameOrigin } from "./pull-request-shared.js";

type Tx = Parameters<Parameters<StageDb["transaction"]>[0]>[0];

export function viewStateRoutes(db: StageDb): Route[] {
	return [
		{
			method: "POST",
			pattern: "/api/chapter-view/:chapterId",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const { rows, initiatingRunId } = resolveChapterRows(db, params.chapterId);
				if (rows.length === 0) {
					writeJson(res, 404, { error: `Chapter ${params.chapterId} not found` });
					return;
				}
				// External-id fan-out: re-imports of the same diff produce multiple chapter
				// rows sharing one externalId, and view-state must survive across them.
				const cfvInserts = chapterFileViewInserts(rows);
				let promoted: RunPath[] = [];
				db.transaction((tx) => {
					tx.insert(chapterView)
						.values(rows.map((r) => ({ userId: LOCAL_USER_ID, chapterId: r.id })))
						.onConflictDoNothing()
						.run();

					// file_view is only promoted once every chapter in the run touching a
					// path has a chapter_file_view row for it — see promoteFullyCoveredFiles.
					if (cfvInserts.length === 0) return;
					tx.insert(chapterFileView).values(cfvInserts).onConflictDoNothing().run();

					promoted = promoteFullyCoveredFiles(tx, touchedRunPaths(rows));
				});
				// Hosted's mark rule: a file reaches GitHub only once every chapter
				// containing it is viewed — exactly the promotion condition above.
				// Sibling rows updated by the fan-out stay local-only: GitHub sync is
				// scoped to the run the user acted in (see initiatingRunPaths).
				await new GitHubViewSync(db).mark(initiatingRunPaths(promoted, initiatingRunId));
				writeJson(res, 200, {});
			},
		},
		{
			method: "DELETE",
			pattern: "/api/chapter-view/:chapterId",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const { rows, initiatingRunId } = resolveChapterRows(db, params.chapterId);
				if (rows.length === 0) {
					// Idempotent: if the chapter doesn't exist there's nothing to delete. The SPA
					// shouldn't have to distinguish "row was gone" from "chapter was gone".
					writeJson(res, 200, {});
					return;
				}
				const touched = touchedRunPaths(rows);
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
					if (touched.length === 0) return;
					// Exact (runId, filePath) pairs — independent IN lists would clear
					// the cartesian product and wipe unrelated views on sibling runs.
					for (const { runId, filePath } of touched) {
						tx.delete(fileView)
							.where(
								and(
									eq(fileView.userId, LOCAL_USER_ID),
									eq(fileView.runId, runId),
									eq(fileView.filePath, filePath),
								),
							)
							.run();
					}
				});
				// Hosted's unmark rule: any chapter-file unview unmarks the path on
				// GitHub unconditionally, mirroring the file_view clear above — but
				// only on the initiating run's own PR (see initiatingRunPaths).
				await new GitHubViewSync(db).unmark(initiatingRunPaths(touched, initiatingRunId));
				writeJson(res, 200, {});
			},
		},
		{
			method: "POST",
			pattern: "/api/key-change-view/:keyChangeId",
			handler: (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
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
			handler: (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
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
				if (!enforceSameOrigin(req, res)) return;
				const runId = params.runId;
				if (!runId) {
					writeJson(res, 400, { error: "Missing runId" });
					return;
				}
				if (!runExists(db, runId)) {
					writeJson(res, 404, { error: `Run ${runId} not found` });
					return;
				}

				const parsed = await parseJsonBody(req, res, FileViewBodySchema);
				if (!parsed) return;

				// Direct file mark deliberately doesn't backfill chapter_file_view — the
				// intent is "I've reviewed this file", not "every chapter covers it".
				db.insert(fileView)
					.values({ userId: LOCAL_USER_ID, runId, filePath: parsed.path })
					.onConflictDoNothing()
					.run();
				await new GitHubViewSync(db).mark([{ runId, filePath: parsed.path }]);
				writeJson(res, 200, {});
			},
		},
		{
			method: "DELETE",
			pattern: "/api/runs/:runId/file-views",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const runId = params.runId;
				if (!runId) {
					writeJson(res, 400, { error: "Missing runId" });
					return;
				}
				if (!runExists(db, runId)) {
					writeJson(res, 200, {});
					return;
				}

				const parsed = await parseJsonBody(req, res, FileViewBodySchema);
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
				await new GitHubViewSync(db).unmark([{ runId, filePath: parsed.path }]);
				writeJson(res, 200, {});
			},
		},
		{
			method: "GET",
			pattern: "/api/runs/:runId/view-state",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
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
					filePaths: await withGitHubViewedPaths(
						run,
						viewedFiles.map((r) => r.filePath),
					),
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

interface ResolvedChapters {
	rows: ResolvedChapterRow[];
	/**
	 * The run the request was made in: the matched row's run for a uuid lookup,
	 * or the single run every externalId match lives in. Null when the
	 * externalId spans multiple runs — the request alone can't tell which
	 * sibling the user was viewing. GitHub sync is scoped to this run; local
	 * writes always apply to every resolved row.
	 */
	initiatingRunId: string | null;
}

// Looks up by uuid first, falling back to externalId so re-imports of the same
// scope (which share an externalId across chapter rows) all get the cascade.
function resolveChapterRows(db: StageDb, idOrExternalId: string | undefined): ResolvedChapters {
	if (!idOrExternalId) return { rows: [], initiatingRunId: null };
	const cols = { id: chapter.id, runId: chapter.runId, hunkRefs: chapter.hunkRefs };
	const byPk = db.select(cols).from(chapter).where(eq(chapter.id, idOrExternalId)).all();
	const rows =
		byPk.length > 0
			? byPk
			: db.select(cols).from(chapter).where(eq(chapter.externalId, idOrExternalId)).all();
	const runIds = new Set(rows.map((r) => r.runId));
	const [first] = rows;
	return { rows, initiatingRunId: first !== undefined && runIds.size === 1 ? first.runId : null };
}

/**
 * Filters fan-out paths down to the initiating run before GitHub sync. Local
 * view-state deliberately fans out across every run sharing a chapter's
 * externalId, but only the run the user was actually reviewing may touch its
 * pull request — sibling runs (re-imports, clones, forks) reviewed the same
 * diff in sessions the user wasn't in. When the initiating run is unknown (an
 * externalId matching rows in several runs), GitHub is left untouched.
 */
function initiatingRunPaths(paths: RunPath[], initiatingRunId: string | null): RunPath[] {
	if (initiatingRunId !== null) return paths.filter((p) => p.runId === initiatingRunId);
	if (paths.length > 0) {
		console.error(
			"Skipping GitHub view sync: the chapter id matches rows in multiple runs, so the initiating run is unknown",
		);
	}
	return [];
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
 * Returns the promoted paths so callers can propagate the mark to GitHub.
 */
function promoteFullyCoveredFiles(tx: Tx, touched: RunPath[]): RunPath[] {
	if (touched.length === 0) return [];
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
	const promoted: RunPath[] = [];
	for (const t of touched) {
		const have = marked.get(t.runId)?.get(t.filePath) ?? 0;
		const need = containing.get(t.runId)?.get(t.filePath) ?? 0;
		if (need > 0 && have === need) {
			promoted.push({ runId: t.runId, filePath: t.filePath });
		}
	}
	if (promoted.length > 0) {
		tx.insert(fileView)
			.values(
				promoted.map((p) => ({ userId: LOCAL_USER_ID, runId: p.runId, filePath: p.filePath })),
			)
			.onConflictDoNothing()
			.run();
	}
	return promoted;
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

// ─── GitHub viewed-state sync (runs that resolve to a PR, always best-effort) ────

interface PullRequestRunTarget {
	repoRoot: string;
	repo: GitHubRepo;
	prNumber: number;
}

/**
 * A run's GitHub PR context. `--pr` runs carry their number; branch runs
 * resolve the PR of the branch recorded at import time (`headRef`), so the
 * sync keeps targeting the PR the user actually reviewed even after the
 * checkout moves to a different branch — including one whose PR shares the
 * same head SHA, which the headSha freshness gate alone can't distinguish.
 * Returns null when there is genuinely no PR — no GitHub remote, an import
 * from a detached HEAD (no recorded branch), or a branch with no PR — and
 * throws when gh itself fails, so callers can tell "no PR" from "couldn't
 * ask GitHub".
 */
async function pullRequestRunTarget(run: {
	repoRoot: string;
	originUrl: string | null;
	prNumber: number | null;
	headRef: string | null;
}): Promise<PullRequestRunTarget | null> {
	const repo = parseGitHubRepo(run.originUrl);
	if (!repo) return null;
	if (run.prNumber !== null) return { repoRoot: run.repoRoot, repo, prNumber: run.prNumber };
	if (run.headRef === null) return null;
	const pr = await getPullRequestOrThrow(run.repoRoot, run.originUrl, { branch: run.headRef });
	if (!pr) return null;
	return { repoRoot: run.repoRoot, repo, prNumber: pr.number };
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** The run fields freshness gating needs, threaded from the chapter_run row. */
interface PullRequestRunContext {
	repoRoot: string;
	originUrl: string | null;
	prNumber: number | null;
	headRef: string | null;
	scopeKind: ScopeKind;
	headSha: string;
}

/**
 * A run's pull request after the freshness gate: the live PR when the run's
 * diff is the one the PR currently shows, or why it isn't.
 */
type FreshPullRequestDecision =
	| { kind: "fresh"; repoRoot: string; repo: GitHubRepo; prNumber: number; nodeId: string }
	| { kind: "no-pr" }
	| { kind: "working-tree" }
	| { kind: "stale-head"; prNumber: number };

/**
 * Resolves a run's PR and gates on diff identity the way review writes are
 * gated (see review.ts's runMatchesPrDiff): only a committed run whose
 * recorded head is still the PR's live head resolves as fresh — anything
 * else reviewed different contents than the PR shows. Shared by GitHub view
 * mutations and the GET read-merge so both apply the exact same gate. The
 * scope check runs before any gh call; gh failures propagate so each caller
 * picks its own degradation.
 */
async function resolveFreshPullRequest(
	run: PullRequestRunContext,
): Promise<FreshPullRequestDecision> {
	if (run.scopeKind !== SCOPE_KIND.COMMITTED) return { kind: "working-tree" };
	const prRun = await pullRequestRunTarget(run);
	if (!prRun) return { kind: "no-pr" };
	const identity = await getPullRequestIdentity(prRun.repoRoot, prRun.repo, prRun.prNumber);
	if (identity.headRefOid !== run.headSha) {
		return { kind: "stale-head", prNumber: prRun.prNumber };
	}
	return { kind: "fresh", ...prRun, nodeId: identity.nodeId };
}

/**
 * Unions GitHub's VIEWED file paths into the local set for GET view-state.
 * Read-side merge only — we deliberately don't seed file_view rows from GitHub,
 * so local state stays purely local and offline semantics are unchanged.
 * Reads are freshness-gated exactly like mutations: GitHub's marks refer to
 * the PR's live head contents, so merging them into a working-tree or
 * stale-head run would collapse files the user never reviewed as displayed.
 * GitHub being unreachable degrades to the local paths.
 */
async function withGitHubViewedPaths(
	run: PullRequestRunContext,
	localPaths: string[],
): Promise<string[]> {
	try {
		const decision = await resolveFreshPullRequest(run);
		if (decision.kind !== "fresh") return localPaths;
		const { files } = await getViewedFiles(decision.repoRoot, decision.repo, decision.prNumber);
		const union = new Set(localPaths);
		for (const file of files) {
			if (file.viewerViewedState === FILE_VIEWED_STATE.VIEWED) union.add(file.path);
		}
		return Array.from(union);
	} catch (err) {
		console.error(`Failed to load GitHub viewed files: ${errorMessage(err)}`);
		return localPaths;
	}
}

/**
 * Serializes GitHub view mutations per (runId, filePath). Overlapping mark and
 * unmark requests for the same pair would otherwise race their gh processes
 * and could land on GitHub in the wrong order, desyncing it from local state.
 * A sync batch chains behind the current tail of every pair it touches and
 * becomes their new tail, so mutations for a pair execute in the order the
 * local writes committed. Entries are removed once a tail settles, so retired
 * pairs don't accumulate.
 */
const mutationChains = new Map<string, Map<string, Promise<void>>>();

function chainGitHubMutations(pairs: RunPath[], task: () => Promise<void>): Promise<void> {
	const tails: Array<Promise<void>> = [];
	for (const { runId, filePath } of pairs) {
		const tail = mutationChains.get(runId)?.get(filePath);
		if (tail) tails.push(tail);
	}
	// allSettled: a failed batch must not wedge every later batch for the pair.
	const next = Promise.allSettled(tails).then(task);
	for (const { runId, filePath } of pairs) {
		let byPath = mutationChains.get(runId);
		if (!byPath) {
			byPath = new Map();
			mutationChains.set(runId, byPath);
		}
		byPath.set(filePath, next);
	}
	const cleanup = () => {
		for (const { runId, filePath } of pairs) {
			const byPath = mutationChains.get(runId);
			if (byPath?.get(filePath) !== next) continue;
			byPath.delete(filePath);
			if (byPath.size === 0) mutationChains.delete(runId);
		}
	};
	void next.then(cleanup, cleanup);
	return next;
}

/**
 * Best-effort per-request propagation of file view marks to GitHub, mirroring
 * hosted Stage's chapter-file-view sync rules: mark a file only when every
 * chapter containing it is viewed (the exact condition under which
 * promoteFullyCoveredFiles promotes it locally), and unmark unconditionally
 * whenever any chapter-file view is removed. Sync is scoped to the initiating
 * run — callers pass only that run's paths (see initiatingRunPaths), so a
 * batch never touches any PR other than the one the user was reviewing.
 * Writes are freshness-gated the way review writes are (see review.ts's
 * runMatchesPrDiff): only a committed run whose recorded head is still the
 * PR's live head may touch the PR — anything else reviewed different
 * contents. Every GitHub failure is logged and swallowed — the local
 * operation always succeeds regardless.
 */
class GitHubViewSync {
	constructor(private readonly db: StageDb) {}

	mark(paths: RunPath[]): Promise<void> {
		return this.sync(paths, markFileAsViewed, "viewed");
	}

	unmark(paths: RunPath[]): Promise<void> {
		return this.sync(paths, unmarkFileAsViewed, "unviewed");
	}

	private sync(
		paths: RunPath[],
		mutate: (repoRoot: string, pullRequestNodeId: string, path: string) => Promise<void>,
		verb: "viewed" | "unviewed",
	): Promise<void> {
		const [first] = paths;
		if (!first) return Promise.resolve();
		// Enqueued synchronously (before any await) so overlapping requests chain
		// in the same order their local writes committed.
		return chainGitHubMutations(paths, () =>
			this.performSync(
				first.runId,
				paths.map((p) => p.filePath),
				mutate,
				verb,
			),
		);
	}

	private async performSync(
		runId: string,
		filePaths: string[],
		mutate: (repoRoot: string, pullRequestNodeId: string, path: string) => Promise<void>,
		verb: "viewed" | "unviewed",
	): Promise<void> {
		const target = await this.resolveTarget(runId);
		if (target === null) return;
		for (const filePath of filePaths) {
			try {
				await mutate(target.repoRoot, target.nodeId, filePath);
			} catch (err) {
				console.error(`Failed to sync file ${verb} state to GitHub: ${errorMessage(err)}`);
			}
		}
	}

	/**
	 * The initiating run's writable PR target, or null (with the reason logged)
	 * when the run has no PR or is write-gated by the freshness check.
	 */
	private async resolveTarget(runId: string): Promise<{ repoRoot: string; nodeId: string } | null> {
		const [run] = this.db
			.select({
				repoRoot: chapterRun.repoRoot,
				originUrl: chapterRun.originUrl,
				prNumber: chapterRun.prNumber,
				headRef: chapterRun.headRef,
				scopeKind: chapterRun.scopeKind,
				headSha: chapterRun.headSha,
			})
			.from(chapterRun)
			.where(eq(chapterRun.id, runId))
			.limit(1)
			.all();
		// Every caller resolved the run (or a chapter row referencing it) before
		// enqueueing the sync, so the row is guaranteed to exist.
		if (!run) throw new Error(`Run ${runId} not found for GitHub view sync`);

		let decision: FreshPullRequestDecision;
		try {
			decision = await resolveFreshPullRequest(run);
		} catch (err) {
			console.error(
				`Failed to resolve the run's pull request for GitHub view sync: ${errorMessage(err)}`,
			);
			return null;
		}
		switch (decision.kind) {
			case "no-pr":
				return null;
			case "working-tree":
				console.error(
					"Skipping GitHub viewed sync: working-tree runs don't review the pull request's commits",
				);
				return null;
			case "stale-head":
				console.error(
					`Skipping GitHub viewed sync for pull request #${decision.prNumber}: the run's head commit is no longer the pull request's head`,
				);
				return null;
			case "fresh":
				return { repoRoot: decision.repoRoot, nodeId: decision.nodeId };
		}
	}
}
