import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { closeDb, getDb, type StageDb } from "../db/client.js";
import { chapter } from "../db/schema/index.js";
import type { FileViewedState } from "../github/index.js";
import { viewStateRoutes } from "../routes/view-state.js";
import { insertChaptersFile } from "../runs/import-chapters.js";
import type { ChaptersFile } from "../schema.js";
import { LOOPBACK_HOST, type ServerHandle, startServer } from "../server.js";
import { makeFixture, makeRepoContext, SHA } from "./fixtures.js";

export const GITHUB_ORIGIN = "git@github.com:owner/repo.git";
export const PR_NUMBER = 7;
export const PR_NODE_ID = "PR_node1";
/** Branch recorded on seeded runs; the shim's `gh pr view` reports its PR as PR_NUMBER. */
export const BRANCH_HEAD_REF = "feature";

interface ViewedFileNode {
	path: string;
	viewerViewedState: FileViewedState;
}

/** One `GetPullRequestViewedFiles` response page in gh's raw GraphQL envelope. */
export function makeViewedFilesPage(
	files: Array<ViewedFileNode | null>,
	endCursor: string | null = null,
): unknown {
	return {
		data: {
			repository: {
				pullRequest: {
					id: PR_NODE_ID,
					files: {
						nodes: files,
						pageInfo: { hasNextPage: endCursor !== null, endCursor },
					},
				},
			},
		},
	};
}

export interface GraphqlCall {
	name: string;
	fields: Record<string, string>;
}

export interface GhShimOptions {
	/** headRefOid served by both `gh pr view` and the identity query. */
	prHeadSha?: string;
	/** PR number `gh pr view` reports for the checked-out branch; null → "no pull requests found". */
	branchPrNumber?: number | null;
	/** Delay (ms) before the shim answers the first mark/unmark mutation, to force overlap. */
	firstMutationDelayMs?: number;
	/** Make the `GetPullRequestIdentity` query fail while everything else succeeds. */
	failIdentityQuery?: boolean;
}

interface SeedRunOptions {
	prNumber?: number | null;
	originUrl?: string | null;
	/** Import-time branch stored on the run; null models an import from a detached HEAD. */
	headRef?: string | null;
}

export class ViewStateGitHubHarness {
	private tmpDir = "";
	private dbPath = "";
	private webDist = "";
	private repoRoot = "";
	private binDir = "";
	private originalPath: string | undefined;
	private readonly handles: ServerHandle[] = [];

	get db(): StageDb {
		return getDb({ dbPath: this.dbPath });
	}

	async setup(): Promise<void> {
		this.tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage-cli-view-state-github-"));
		this.dbPath = path.join(this.tmpDir, "db.sqlite");
		this.webDist = path.join(this.tmpDir, "web-dist");
		this.repoRoot = path.join(this.tmpDir, "repo");
		this.binDir = path.join(this.tmpDir, "bin");
		await fs.mkdir(this.webDist);
		await fs.writeFile(path.join(this.webDist, "index.html"), "<html></html>");
		await fs.mkdir(this.repoRoot);
		await fs.mkdir(this.binDir);
		this.originalPath = process.env.PATH;
		process.env.PATH = `${this.binDir}${path.delimiter}${this.originalPath ?? ""}`;
		closeDb();
	}

	async teardown(): Promise<void> {
		while (this.handles.length > 0) {
			const handle = this.handles.pop();
			if (handle) await handle.close();
		}
		closeDb();
		process.env.PATH = this.originalPath;
		await fs.rm(this.tmpDir, { recursive: true, force: true });
	}

	/**
	 * Installs a fake `gh` answering the viewed-files GraphQL operations plus the
	 * `gh pr view` / REST calls branch-PR resolution makes. Viewed-files pages are
	 * selected by the `after` cursor variable: absent → first page, present →
	 * second page. Mutations append `{ name, path }` to a completions log in
	 * response order so tests can assert GitHub-side ordering.
	 */
	async writeGhShim(
		viewedFilesPages: unknown[] = [makeViewedFilesPage([])],
		options: GhShimOptions = {},
	): Promise<void> {
		const prHeadSha = options.prHeadSha ?? SHA.head;
		const branchPrNumber =
			options.branchPrNumber === undefined ? PR_NUMBER : options.branchPrNumber;
		const firstMutationDelayMs = options.firstMutationDelayMs ?? 0;
		const shim = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const argvLog = ${JSON.stringify(this.argvLogPath())};
fs.appendFileSync(argvLog, JSON.stringify(args) + "\\n");
function emit(o) { process.stdout.write(JSON.stringify(o)); }
if (args[0] === "pr" && args[1] === "list") {
  const branchPrNumber = ${JSON.stringify(branchPrNumber)};
  emit(branchPrNumber === null ? [] : [{ number: branchPrNumber, state: "OPEN" }]);
} else if (args[0] === "pr" && args[1] === "view") {
  const branchPrNumber = ${JSON.stringify(branchPrNumber)};
  if (branchPrNumber === null) {
    process.stderr.write('no pull requests found for branch "feature"\\n');
    process.exit(1);
  }
  emit({
    number: branchPrNumber,
    title: "Branch PR",
    body: null,
    url: "https://github.com/owner/repo/pull/" + branchPrNumber,
    state: "OPEN",
    isDraft: false,
    mergedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    author: null,
    headRefName: "feature",
    headRefOid: ${JSON.stringify(prHeadSha)},
    baseRefName: "main",
  });
} else if (args[0] === "api" && args[1] !== "graphql") {
  emit({ user: null });
} else {
  const query = args.find((a) => a.startsWith("query=")) || "";
  if (query.includes("query GetPullRequestIdentity")) {
    if (${JSON.stringify(options.failIdentityQuery ?? false)}) {
      process.stderr.write("gh shim: identity query failed\\n");
      process.exit(1);
    }
    emit({ data: { repository: { pullRequest: { id: ${JSON.stringify(PR_NODE_ID)}, headRefOid: ${JSON.stringify(prHeadSha)} } } } });
  } else if (query.includes("query GetPullRequestViewedFiles")) {
    const pages = ${JSON.stringify(viewedFilesPages)};
    emit(args.some((a) => a.startsWith("after=")) ? pages[1] : pages[0]);
  } else if (query.includes("mutation MarkFileAsViewed") || query.includes("mutation UnmarkFileAsViewed")) {
    const mark = query.includes("mutation MarkFileAsViewed");
    const name = mark ? "MarkFileAsViewed" : "UnmarkFileAsViewed";
    const filePath = (args.find((a) => a.startsWith("path=")) || "path=").slice("path=".length);
    const respond = () => {
      fs.appendFileSync(
        ${JSON.stringify(this.completionsLogPath())},
        JSON.stringify({ name, path: filePath }) + "\\n",
      );
      emit({ data: { [mark ? "markFileAsViewed" : "unmarkFileAsViewed"]: { clientMutationId: null } } });
    };
    const delayMs = ${JSON.stringify(firstMutationDelayMs)};
    const priorMutations = fs
      .readFileSync(argvLog, "utf8")
      .split("\\n")
      .filter((line) => line.includes("mutation ")).length;
    // priorMutations includes this call's own argv line.
    if (delayMs > 0 && priorMutations === 1) setTimeout(respond, delayMs);
    else respond();
  } else {
    process.stderr.write("gh shim: unexpected call\\n");
    process.exit(1);
  }
}
`;
		await fs.writeFile(path.join(this.binDir, "gh"), shim);
		await fs.chmod(path.join(this.binDir, "gh"), 0o755);
	}

	async writeFailingGhShim(): Promise<void> {
		await fs.writeFile(
			path.join(this.binDir, "gh"),
			"#!/bin/sh\nprintf 'gh: authentication required\\n' >&2\nexit 1\n",
		);
		await fs.chmod(path.join(this.binDir, "gh"), 0o755);
	}

	/** Imports a chapters file as a run, defaulting to a PR run on a GitHub remote. */
	seedRun(
		fixture: ChaptersFile = makeFixture(),
		options: SeedRunOptions = {},
	): { runId: string; chapters: Array<typeof chapter.$inferSelect> } {
		const originUrl = options.originUrl === undefined ? GITHUB_ORIGIN : options.originUrl;
		const prNumber = options.prNumber === undefined ? PR_NUMBER : options.prNumber;
		const headRef = options.headRef === undefined ? BRANCH_HEAD_REF : options.headRef;
		const { runId } = insertChaptersFile(
			this.db,
			fixture,
			makeRepoContext({ root: this.repoRoot, originUrl, headRef }),
			prNumber,
		);
		const chapters = this.db.select().from(chapter).where(eq(chapter.runId, runId)).all();
		return { runId, chapters };
	}

	async start(): Promise<number> {
		const handle = await startServer({
			webDistPath: this.webDist,
			routes: viewStateRoutes(this.db),
		});
		this.handles.push(handle);
		return handle.port;
	}

	request(
		port: number,
		method: string,
		requestPath: string,
		body?: unknown,
	): Promise<{ status: number; body: string }> {
		return new Promise((resolve, reject) => {
			const payload = body === undefined ? undefined : JSON.stringify(body);
			const req = http.request(
				{
					hostname: LOOPBACK_HOST,
					port,
					method,
					path: requestPath,
					agent: false,
					headers:
						payload === undefined
							? {}
							: {
									"Content-Type": "application/json",
									"Content-Length": Buffer.byteLength(payload),
								},
				},
				(res) => {
					const chunks: Buffer[] = [];
					res.on("data", (chunk: Buffer) => chunks.push(chunk));
					res.on("end", () =>
						resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
					);
				},
			);
			req.on("error", reject);
			req.end(payload);
		});
	}

	/** Every gh invocation so far, as raw argv arrays (GraphQL, `pr view`, and REST alike). */
	async rawCalls(): Promise<string[][]> {
		const text = await fs.readFile(this.argvLogPath(), "utf8").catch(() => "");
		return text
			.split("\n")
			.filter(Boolean)
			.map((line): string[] => JSON.parse(line));
	}

	/** Every gh GraphQL call so far, as operation name plus `-f`/`-F` variables. */
	async graphqlCalls(): Promise<GraphqlCall[]> {
		return (await this.rawCalls())
			.filter((args) => args.some((arg) => arg.startsWith("query=")))
			.map((args) => {
				const fields: Record<string, string> = {};
				let name = "";
				for (const arg of args) {
					const eqIdx = arg.indexOf("=");
					if (eqIdx < 0) continue;
					const key = arg.slice(0, eqIdx);
					const value = arg.slice(eqIdx + 1);
					if (key === "query") {
						name = value.match(/^(?:query|mutation) (\w+)/)?.[1] ?? "";
					} else {
						fields[key] = value;
					}
				}
				return { name, fields };
			});
	}

	/** Mark/unmark mutations in the order the shim answered them (not spawn order). */
	async mutationCompletions(): Promise<Array<{ name: string; path: string }>> {
		const text = await fs.readFile(this.completionsLogPath(), "utf8").catch(() => "");
		return text
			.split("\n")
			.filter(Boolean)
			.map((line): { name: string; path: string } => JSON.parse(line));
	}

	/** Polls the argv log until a gh call matching `predicate` has been spawned. */
	async waitForGhCall(predicate: (args: string[]) => boolean, timeoutMs = 5000): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if ((await this.rawCalls()).some(predicate)) return;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		throw new Error("Timed out waiting for the expected gh call");
	}

	private argvLogPath(): string {
		return path.join(this.binDir, "gh-argv.log");
	}

	private completionsLogPath(): string {
		return path.join(this.binDir, "gh-completions.log");
	}
}
