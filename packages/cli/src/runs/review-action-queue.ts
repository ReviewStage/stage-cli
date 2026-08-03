import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { type LockOptions, lock } from "proper-lockfile";
import { getStageDataDir } from "../db/path.js";

const LOCK_STALE_MS = 30_000;
const LOCK_UPDATE_MS = 10_000;
const LOCK_RETRIES = {
	retries: 120,
	factor: 1.2,
	minTimeout: 50,
	maxTimeout: 1_000,
	randomize: true,
};

export const REVIEW_ACTION_SCOPE = {
	LOCAL_THREAD: "localThread",
	PULL_REQUEST: "pullRequest",
} as const;

export type ReviewActionScope =
	| {
			kind: typeof REVIEW_ACTION_SCOPE.LOCAL_THREAD;
			threadId: string;
	  }
	| {
			kind: typeof REVIEW_ACTION_SCOPE.PULL_REQUEST;
			owner: string;
			repo: string;
			prNumber: number;
	  };

type AcquireLock = (file: string, options: LockOptions) => Promise<() => Promise<void>>;

/**
 * Serializes review actions within this process and across other `stagereview`
 * processes. Lock files live in Stage's writable per-user data directory so the
 * same pull request shares a lock across clones and worktrees.
 */
export class ReviewActionQueue {
	private readonly tails = new Map<string, Promise<void>>();
	private readonly lockDirectory: string;
	private readonly acquireLock: AcquireLock;

	constructor(
		lockDirectory = path.join(getStageDataDir(), "review-locks"),
		acquireLock: AcquireLock = lock,
	) {
		this.lockDirectory = lockDirectory;
		this.acquireLock = acquireLock;
	}

	async run<T>(scope: ReviewActionScope, action: () => Promise<T>): Promise<T> {
		const key = scopeKey(scope);
		const previous = this.tails.get(key) ?? Promise.resolve();
		const result = previous.then(
			() => this.runLocked(key, action),
			() => this.runLocked(key, action),
		);
		const settled = result.then(
			() => undefined,
			() => undefined,
		);
		this.tails.set(key, settled);
		try {
			return await result;
		} finally {
			if (this.tails.get(key) === settled) this.tails.delete(key);
		}
	}

	private async runLocked<T>(key: string, action: () => Promise<T>): Promise<T> {
		mkdirSync(this.lockDirectory, { recursive: true });
		const lockTargetPath = path.join(
			this.lockDirectory,
			createHash("sha256").update(key).digest("hex"),
		);
		let compromisedError: Error | null = null;
		const release = await this.acquireLock(lockTargetPath, {
			realpath: false,
			stale: LOCK_STALE_MS,
			update: LOCK_UPDATE_MS,
			retries: LOCK_RETRIES,
			onCompromised: (error) => {
				compromisedError = error;
				process.stderr.write(`Review action lock compromised: ${error.message}\n`);
			},
		});
		const actionResult = await Promise.resolve()
			.then(action)
			.then(
				(value) => ({ status: "fulfilled" as const, value }),
				(error: unknown) => ({ status: "rejected" as const, error }),
			);
		try {
			await release();
		} catch (error) {
			// proper-lockfile marks a compromised lock released before invoking the
			// callback, so its release function then reports ERELEASED. Preserve every
			// other release failure.
			if (compromisedError === null || errorCode(error) !== "ERELEASED") throw error;
		}
		if (actionResult.status === "rejected") throw actionResult.error;
		return actionResult.value;
	}
}

/** Shared queue for review mutations and mutations of existing local threads. */
export const reviewActions = new ReviewActionQueue();

function scopeKey(scope: ReviewActionScope): string {
	switch (scope.kind) {
		case REVIEW_ACTION_SCOPE.LOCAL_THREAD:
			return JSON.stringify([scope.kind, scope.threadId]);
		case REVIEW_ACTION_SCOPE.PULL_REQUEST:
			return JSON.stringify([
				scope.kind,
				scope.owner.toLowerCase(),
				scope.repo.toLowerCase(),
				scope.prNumber,
			]);
	}
}

function errorCode(error: unknown): unknown {
	return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}
