import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { lock } from "proper-lockfile";
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
	CHECKOUT: "checkout",
	PULL_REQUEST: "pullRequest",
} as const;

export type ReviewActionScope =
	| {
			kind: typeof REVIEW_ACTION_SCOPE.CHECKOUT;
			repoRoot: string;
	  }
	| {
			kind: typeof REVIEW_ACTION_SCOPE.PULL_REQUEST;
			owner: string;
			repo: string;
			prNumber: number;
	  };

/**
 * Serializes review actions within this process and across other `stagereview`
 * processes. Lock files live in Stage's writable per-user data directory so the
 * same pull request shares a lock across clones and worktrees.
 */
export class ReviewActionQueue {
	private readonly tails = new Map<string, Promise<void>>();
	private readonly lockDirectory: string;

	constructor(lockDirectory = path.join(getStageDataDir(), "review-locks")) {
		this.lockDirectory = lockDirectory;
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
		const release = await lock(lockTargetPath, {
			realpath: false,
			stale: LOCK_STALE_MS,
			update: LOCK_UPDATE_MS,
			retries: LOCK_RETRIES,
		});
		try {
			return await action();
		} finally {
			await release();
		}
	}
}

/** Shared queue for review mutations and mutations of existing local threads. */
export const reviewActions = new ReviewActionQueue();

function scopeKey(scope: ReviewActionScope): string {
	switch (scope.kind) {
		case REVIEW_ACTION_SCOPE.CHECKOUT:
			return JSON.stringify([scope.kind, path.resolve(scope.repoRoot)]);
		case REVIEW_ACTION_SCOPE.PULL_REQUEST:
			return JSON.stringify([
				scope.kind,
				scope.owner.toLowerCase(),
				scope.repo.toLowerCase(),
				scope.prNumber,
			]);
	}
}
