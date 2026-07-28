import { lock } from "proper-lockfile";

const LOCK_STALE_MS = 30_000;
const LOCK_UPDATE_MS = 10_000;
const LOCK_RETRIES = {
	retries: 120,
	factor: 1.2,
	minTimeout: 50,
	maxTimeout: 1_000,
	randomize: true,
};

/**
 * Serializes pending-review actions both within this process and across other
 * `stagereview show` processes serving the same checkout.
 */
export class ReviewActionQueue {
	private readonly tails = new Map<string, Promise<void>>();

	async run<T>(repoRoot: string, action: () => Promise<T>): Promise<T> {
		const previous = this.tails.get(repoRoot) ?? Promise.resolve();
		const result = previous.then(
			() => this.runLocked(repoRoot, action),
			() => this.runLocked(repoRoot, action),
		);
		const settled = result.then(
			() => undefined,
			() => undefined,
		);
		this.tails.set(repoRoot, settled);
		try {
			return await result;
		} finally {
			if (this.tails.get(repoRoot) === settled) this.tails.delete(repoRoot);
		}
	}

	private async runLocked<T>(repoRoot: string, action: () => Promise<T>): Promise<T> {
		const release = await lock(repoRoot, {
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
