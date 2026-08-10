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
import { SCOPE_KIND } from "../schema.js";
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
				const rows = resolveChapterRows(db, params.chapterId);
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
				await new GitHubViewSync(db).mark(promoted);
				writeJson(res, 200, {});
			},
		},
		{
			method: "DELETE",
			pattern: "/api/chapter-view/:chapterId",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const rows = resolveChapterRows(db, params.chapterId);
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
				// GitHub unconditionally, mirroring the file_view clear above.
				await new GitHubViewSync(db).unmark(touched);
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
 * resolve the PR of whatever branch the run's clone has checked out, via
 * `gh pr view` in the run's repoRoot (the same discovery the review routes
 * use). Returns null when there is genuinely no PR — no GitHub remote, or a
 * branch with no PR — and throws when gh itself fails, so callers can tell
 * "no PR" from "couldn't ask GitHub".
 */
async function pullRequestRunTarget(run: {
	repoRoot: string;
	originUrl: string | null;
	prNumber: number | null;
}): Promise<PullRequestRunTarget | null> {
	const repo = parseGitHubRepo(run.originUrl);
	if (!repo) return null;
	if (run.prNumber !== null) return { repoRoot: run.repoRoot, repo, prNumber: run.prNumber };
	const pr = await getPullRequestOrThrow(run.repoRoot, run.originUrl, null);
	if (!pr) return null;
	return { repoRoot: run.repoRoot, repo, prNumber: pr.number };
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * Unions GitHub's VIEWED file paths into the local set for GET view-state.
 * Read-side merge only — we deliberately don't seed file_view rows from GitHub,
 * so local state stays purely local and offline semantics are unchanged.
 * Unlike mutations, reads aren't freshness-gated: showing which files GitHub
 * already considers viewed is harmless even for working-tree or stale-head
 * runs. GitHub being unreachable degrades to the local paths.
 */
async function withGitHubViewedPaths(
	run: { repoRoot: string; originUrl: string | null; prNumber: number | null },
	localPaths: string[],
): Promise<string[]> {
	try {
		const target = await pullRequestRunTarget(run);
		if (!target) return localPaths;
		const { files } = await getViewedFiles(target.repoRoot, target.repo, target.prNumber);
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

/** A run's sync decision: a writable PR target, or why it has none. */
type SyncDecision = { repoRoot: string; nodeId: string } | "no-pr" | "skipped" | "unresolved";

/**
 * Best-effort per-request propagation of file view marks to GitHub, mirroring
 * hosted Stage's chapter-file-view sync rules: mark a file only when every
 * chapter containing it is viewed (the exact condition under which
 * promoteFullyCoveredFiles promotes it locally), and unmark unconditionally
 * whenever any chapter-file view is removed. Writes are freshness-gated the
 * way review writes are (see review.ts's runMatchesPrDiff): only a committed
 * run whose recorded head is still the PR's live head may touch the PR —
 * anything else reviewed different contents. Every GitHub failure is logged
 * and swallowed — the local operation always succeeds regardless.
 */
class GitHubViewSync {
	/**
	 * runId → sync decision. "no-pr" rows are safely ignorable in the ambiguity
	 * check: the run either has no GitHub remote (a local-only diff that can't
	 * reference any PR) or its checked-out branch has no PR (nothing to
	 * mutate) — since branch runs now resolve their PR via gh, "no-pr" never
	 * conceals a live PR. "skipped" rows resolved fine but are write-gated
	 * (working-tree scope, or a head that is no longer the PR's), a deliberate
	 * per-run skip that shouldn't block sibling runs. "unresolved" rows failed
	 * PR resolution and must poison every path they touch — otherwise a fork
	 * with unavailable GitHub access would make another run's PR look
	 * unambiguous.
	 */
	private readonly targets = new Map<string, SyncDecision>();

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
		if (paths.length === 0) return Promise.resolve();
		// Enqueued synchronously (before any await) so overlapping requests chain
		// in the same order their local writes committed.
		return chainGitHubMutations(paths, () => this.performSync(paths, mutate, verb));
	}

	private async performSync(
		paths: RunPath[],
		mutate: (repoRoot: string, pullRequestNodeId: string, path: string) => Promise<void>,
		verb: "viewed" | "unviewed",
	): Promise<void> {
		// External-id fan-out can match runs from clones or forks that share a
		// commit range but belong to different PRs. Syncing all of them would
		// mark files on foreign repositories' PRs, so a path only syncs when
		// every run it fanned out to resolves to one PR (node id); same-PR
		// re-imports dedupe to a single mutation.
		const targetsByPath = new Map<string, Map<string, { repoRoot: string; nodeId: string }>>();
		const unresolvedPaths = new Set<string>();
		for (const { runId, filePath } of paths) {
			const target = await this.resolveTarget(runId);
			if (target === "no-pr" || target === "skipped") continue;
			if (target === "unresolved") {
				unresolvedPaths.add(filePath);
				continue;
			}
			let byNode = targetsByPath.get(filePath);
			if (!byNode) {
				byNode = new Map();
				targetsByPath.set(filePath, byNode);
			}
			byNode.set(target.nodeId, target);
		}
		for (const [filePath, byNode] of targetsByPath) {
			if (byNode.size > 1 || unresolvedPaths.has(filePath)) {
				console.error(
					`Skipping GitHub ${verb} sync for ${filePath}: matched runs do not resolve to a single pull request`,
				);
				continue;
			}
			for (const target of byNode.values()) {
				try {
					await mutate(target.repoRoot, target.nodeId, filePath);
				} catch (err) {
					console.error(`Failed to sync file ${verb} state to GitHub: ${errorMessage(err)}`);
				}
			}
		}
	}

	private async resolveTarget(runId: string): Promise<SyncDecision> {
		const cached = this.targets.get(runId);
		if (cached !== undefined) return cached;
		const decision = await this.decideTarget(runId);
		this.targets.set(runId, decision);
		return decision;
	}

	private async decideTarget(runId: string): Promise<SyncDecision> {
		const [run] = this.db
			.select({
				repoRoot: chapterRun.repoRoot,
				originUrl: chapterRun.originUrl,
				prNumber: chapterRun.prNumber,
				scopeKind: chapterRun.scopeKind,
				headSha: chapterRun.headSha,
			})
			.from(chapterRun)
			.where(eq(chapterRun.id, runId))
			.limit(1)
			.all();
		if (!run) return "no-pr";

		// Working-tree marks reflect uncommitted contents the PR has never seen,
		// so they never write to GitHub — decided before any gh call.
		if (run.scopeKind !== SCOPE_KIND.COMMITTED) {
			console.error(
				"Skipping GitHub viewed sync: working-tree runs don't review the pull request's commits",
			);
			return "skipped";
		}

		let prRun: PullRequestRunTarget | null;
		try {
			prRun = await pullRequestRunTarget(run);
		} catch (err) {
			console.error(
				`Failed to resolve the run's pull request for GitHub view sync: ${errorMessage(err)}`,
			);
			return "unresolved";
		}
		if (!prRun) return "no-pr";

		try {
			const identity = await getPullRequestIdentity(prRun.repoRoot, prRun.repo, prRun.prNumber);
			if (identity.headRefOid !== run.headSha) {
				console.error(
					`Skipping GitHub viewed sync for pull request #${prRun.prNumber}: the run's head commit is no longer the pull request's head`,
				);
				return "skipped";
			}
			return { repoRoot: prRun.repoRoot, nodeId: identity.nodeId };
		} catch (err) {
			console.error(
				`Failed to resolve pull request identity for GitHub view sync: ${errorMessage(err)}`,
			);
			return "unresolved";
		}
	}
}
