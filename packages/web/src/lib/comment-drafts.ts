import type { DiffLineAnnotation } from "@pierre/diffs";
import type { DiffSide } from "@/lib/diff-types";
import { type DisplayThread, displayThreadAnchor } from "@/lib/merge-threads";

/** An in-progress comment the reviewer is composing, anchored to a line range. */
export interface CommentDraft {
	side: DiffSide;
	startLine: number;
	endLine: number;
}

/** A draft plus the last submit error for its composer (null while clean). */
export interface DraftState extends CommentDraft {
	error: string | null;
}

/**
 * In-progress composer text indexed by anchor (side → endLine → text). Held in a
 * ref rather than React state so typing never rebuilds the annotation list, and so
 * a composer's text survives the remount that adding/removing another draft causes.
 */
export type DraftBodies = Map<DiffSide, Map<number, string>>;

export function readDraftBody(bodies: DraftBodies, side: DiffSide, endLine: number): string {
	return bodies.get(side)?.get(endLine) ?? "";
}

export function writeDraftBody(
	bodies: DraftBodies,
	side: DiffSide,
	endLine: number,
	text: string,
): void {
	let byLine = bodies.get(side);
	if (!byLine) {
		byLine = new Map();
		bodies.set(side, byLine);
	}
	byLine.set(endLine, text);
}

export function clearDraftBody(bodies: DraftBodies, side: DiffSide, endLine: number): void {
	bodies.get(side)?.delete(endLine);
}

/** A draft is identified by the annotation row it renders on: its `(side, endLine)`. */
export function isSameAnchor(draft: CommentDraft, side: DiffSide, endLine: number): boolean {
	return draft.side === side && draft.endLine === endLine;
}

/**
 * The composer renders on the annotation row for its `(side, endLine)`, so at most
 * one draft can occupy a given row — used to dedupe repeated opens on the same line.
 */
export function findDraftAt(
	drafts: readonly DraftState[],
	side: DiffSide,
	endLine: number,
): DraftState | undefined {
	return drafts.find((draft) => isSameAnchor(draft, side, endLine));
}

/**
 * Opens a composer for the anchor. Since a row holds at most one composer, re-opening
 * the same `(side, endLine)` doesn't duplicate it — instead it adopts the new range's
 * `startLine` (a re-drag that shares the end line but widens/narrows the span) and
 * clears any stale submit error.
 */
export function upsertDraft(drafts: readonly DraftState[], anchor: CommentDraft): DraftState[] {
	if (!findDraftAt(drafts, anchor.side, anchor.endLine)) {
		return [...drafts, { ...anchor, error: null }];
	}
	return drafts.map((draft) =>
		isSameAnchor(draft, anchor.side, anchor.endLine)
			? { ...draft, startLine: anchor.startLine, error: null }
			: draft,
	);
}

/**
 * Groups threads and open drafts into one annotation row per `(side, endLine)`, so
 * Pierre renders a row (existing comments and/or a composer) directly below the line.
 */
export function buildCommentAnnotations(
	threads: readonly DisplayThread[],
	drafts: readonly CommentDraft[],
): DiffLineAnnotation<DisplayThread[]>[] {
	const bySideLine = new Map<DiffSide, Map<number, DiffLineAnnotation<DisplayThread[]>>>();
	const ensure = (side: DiffSide, line: number): DiffLineAnnotation<DisplayThread[]> => {
		let byLine = bySideLine.get(side);
		if (!byLine) {
			byLine = new Map();
			bySideLine.set(side, byLine);
		}
		let entry = byLine.get(line);
		if (!entry) {
			entry = { side, lineNumber: line, metadata: [] };
			byLine.set(line, entry);
		}
		return entry;
	};
	for (const entry of threads) {
		const anchor = displayThreadAnchor(entry);
		ensure(anchor.side, anchor.endLine).metadata.push(entry);
	}
	for (const draft of drafts) ensure(draft.side, draft.endLine);
	const out: DiffLineAnnotation<DisplayThread[]>[] = [];
	for (const byLine of bySideLine.values()) {
		for (const entry of byLine.values()) out.push(entry);
	}
	return out;
}
