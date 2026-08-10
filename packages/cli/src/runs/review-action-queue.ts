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

/**
 * Serializes review actions within this process: actions sharing a scope run one
 * at a time, in submission order. Concurrent `stagereview` processes are not
 * coordinated — simultaneous writes to the same PR from two processes can race.
 */
export class ReviewActionQueue {
	private readonly tails = new Map<string, Promise<void>>();

	async run<T>(scope: ReviewActionScope, action: () => Promise<T>): Promise<T> {
		const key = scopeKey(scope);
		const previous = this.tails.get(key) ?? Promise.resolve();
		const result = previous.then(action, action);
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
