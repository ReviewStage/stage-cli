import { SCOPE_KIND, type ScopeKind, type WorkingTreeRef } from "../schema.js";

export interface ScopeKeyParts {
	scopeKind: ScopeKind;
	/** Required for working-tree scopes; null for committed scopes. */
	workingTreeRef: WorkingTreeRef | null;
	baseSha: string;
	headSha: string;
	mergeBaseSha: string;
}

/**
 * Deterministic key identifying a diff scope, independent of any single run.
 * Re-imports of the same diff produce the same scope key, which is how review
 * state and line-anchored comments survive content regeneration. The shape
 * matches a `chapter_run` row so callers can pass one directly.
 */
export function deriveScopeKey(parts: ScopeKeyParts): string {
	const { scopeKind, workingTreeRef, baseSha, headSha, mergeBaseSha } = parts;
	if (scopeKind === SCOPE_KIND.COMMITTED) {
		return `committed:${baseSha}:${headSha}:${mergeBaseSha}`;
	}
	return `workingTree:${workingTreeRef}:${baseSha}:${headSha}:${mergeBaseSha}`;
}
