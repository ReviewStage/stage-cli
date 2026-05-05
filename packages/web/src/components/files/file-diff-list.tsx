import { FileCode } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { FileHeader } from "@/components/chapter/file-header";
import { PierreDiffViewer } from "@/components/chapter/pierre-diff-viewer";
import { findRenderedDiffLine } from "@/components/chapter/rendered-line-target";
import type { AnnotatedLineRef, DiffSide, LineRef } from "@/lib/diff-types";
import type { FileDiffEntry } from "@/lib/parse-diff";

export interface FileDiffListHandle {
	scrollToFile: (filePath: string) => void;
	scrollToLine: (filePath: string, side: DiffSide, line: number) => void;
	cancelScrollToLine: () => void;
}

export interface CollapseState {
	collapsedFiles: ReadonlySet<string>;
	toggleFileCollapsed: (filePath: string) => void;
	collapseAllFiles: () => void;
	expandAllFiles: () => void;
}

/**
 * Chapter line-ref overlay configuration. Bundled together because each prop
 * is meaningless without the others — passing one without the rest produces a
 * non-functional overlay.
 */
export interface ChapterOverlayProps {
	allLineRefsByFile: Map<string, AnnotatedLineRef[]> | null;
	focusedLineRefsByFile: Map<string, LineRef[]> | null;
	focusedKeyChangeId: string | null;
	isKeyChangeChecked: (keyChangeId: string) => boolean;
	onMarkKeyChangeChecked: (keyChangeId: string) => void;
	onUnmarkKeyChangeChecked: (keyChangeId: string) => void;
	onFocusKeyChange: (keyChangeId: string | null, scrollTarget?: LineRef | null) => void;
}

interface FileDiffListProps {
	entries: FileDiffEntry[];
	emptyMessage: string;
	viewedPathSet?: ReadonlySet<string>;
	onToggleViewed?: (path: string) => void;
	collapseState: CollapseState;
	chapterOverlay?: ChapterOverlayProps;
}

const FILE_TOP_PADDING = 16;
const SCROLL_TO_LINE_POLL_MS = 100;
const SCROLL_TO_LINE_TIMEOUT_MS = 3000;

export const FileDiffList = forwardRef<FileDiffListHandle, FileDiffListProps>(function FileDiffList(
	{ entries, emptyMessage, viewedPathSet, onToggleViewed, collapseState, chapterOverlay },
	ref,
) {
	const scrollRequestRef = useRef(0);
	const pendingDisconnectsRef = useRef<Set<() => void>>(new Set());

	useEffect(() => {
		const pending = pendingDisconnectsRef.current;
		return () => {
			scrollRequestRef.current += 1;
			for (const disconnect of pending) disconnect();
			pending.clear();
		};
	}, []);

	useImperativeHandle(ref, () => {
		const cancelPending = () => {
			scrollRequestRef.current += 1;
			const pending = pendingDisconnectsRef.current;
			for (const disconnect of pending) disconnect();
			pending.clear();
		};

		const runWithContainer = (
			fileContainer: HTMLElement,
			side: DiffSide,
			line: number,
			isLatestRequest: () => boolean,
		) => {
			const tryScroll = () => {
				if (!isLatestRequest()) return true;

				const diffsContainer = fileContainer.querySelector("diffs-container");
				const shadowRoot = diffsContainer?.shadowRoot;
				if (!shadowRoot) return false;

				const lineEl = findRenderedDiffLine(shadowRoot, side, line);
				if (!lineEl) return false;
				if (lineEl.offsetParent === null) return false;

				lineEl.scrollIntoView({ behavior: "smooth", block: "center" });
				return true;
			};

			if (tryScroll()) return;

			let shadowObserver: MutationObserver | null = null;
			let shadowRootRetryTimer: ReturnType<typeof setInterval> | null = null;
			let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

			const disconnectAll = () => {
				observer.disconnect();
				shadowObserver?.disconnect();
				if (shadowRootRetryTimer) clearInterval(shadowRootRetryTimer);
				if (timeoutHandle) clearTimeout(timeoutHandle);
				pendingDisconnectsRef.current.delete(disconnectAll);
			};

			const attachShadowObserver = (shadowRoot: ShadowRoot) => {
				shadowObserver?.disconnect();
				shadowObserver = new MutationObserver(() => {
					if (!isLatestRequest() || tryScroll()) disconnectAll();
				});
				shadowObserver.observe(shadowRoot, {
					childList: true,
					subtree: true,
				});
			};

			const observer = new MutationObserver(() => {
				if (!isLatestRequest() || tryScroll()) disconnectAll();
			});
			observer.observe(fileContainer, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ["hidden"],
			});
			pendingDisconnectsRef.current.add(disconnectAll);

			const existingShadowRoot = fileContainer.querySelector("diffs-container")?.shadowRoot;
			if (existingShadowRoot) {
				attachShadowObserver(existingShadowRoot);
				if (tryScroll()) disconnectAll();
			} else {
				shadowRootRetryTimer = setInterval(() => {
					if (!isLatestRequest()) {
						disconnectAll();
						return;
					}
					const shadowRoot = fileContainer.querySelector("diffs-container")?.shadowRoot;
					if (!shadowRoot) return;
					if (shadowRootRetryTimer) clearInterval(shadowRootRetryTimer);
					shadowRootRetryTimer = null;
					attachShadowObserver(shadowRoot);
					if (tryScroll()) disconnectAll();
				}, SCROLL_TO_LINE_POLL_MS);
			}

			timeoutHandle = setTimeout(disconnectAll, SCROLL_TO_LINE_TIMEOUT_MS);
		};

		return {
			cancelScrollToLine: cancelPending,
			scrollToFile(filePath: string) {
				cancelPending();
				const el = document.getElementById(`file-${filePath}`);
				if (!el) return;
				const stickyOffset = parseFloat(
					getComputedStyle(el).getPropertyValue("--content-top") || "0",
				);
				const top =
					el.getBoundingClientRect().top + window.scrollY - stickyOffset - FILE_TOP_PADDING;
				window.scrollTo({ top });
			},
			scrollToLine(filePath: string, side: DiffSide, line: number) {
				cancelPending();
				if (!entries.some((e) => e.file.path === filePath)) return;

				const requestToken = scrollRequestRef.current;
				const isLatestRequest = () => scrollRequestRef.current === requestToken;

				if (collapseState.collapsedFiles.has(filePath)) {
					collapseState.toggleFileCollapsed(filePath);
				}

				const fileContainer = document.getElementById(`file-${filePath}`);
				if (!fileContainer) return;
				runWithContainer(fileContainer, side, line, isLatestRequest);
			},
		};
	}, [entries, collapseState]);

	if (entries.length === 0) {
		return (
			<div className="flex h-96 flex-col items-center justify-center rounded-xl border border-border bg-card/50">
				<FileCode className="mb-4 size-12 text-muted-foreground/30" aria-hidden="true" />
				<p className="mt-3 text-muted-foreground text-sm">{emptyMessage}</p>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{entries.map((entry) => (
				<FileDiffSection
					key={entry.file.path}
					entry={entry}
					isViewed={viewedPathSet?.has(entry.file.path) ?? false}
					onToggleViewed={onToggleViewed}
					collapseState={collapseState}
					chapterOverlay={chapterOverlay}
				/>
			))}
		</div>
	);
});

interface FileDiffSectionProps {
	entry: FileDiffEntry;
	isViewed: boolean;
	onToggleViewed?: (path: string) => void;
	collapseState: CollapseState;
	chapterOverlay?: ChapterOverlayProps;
}

function FileDiffSection({
	entry,
	isViewed,
	onToggleViewed,
	collapseState,
	chapterOverlay,
}: FileDiffSectionProps) {
	const { file, diff } = entry;
	const isCollapsed = collapseState.collapsedFiles.has(file.path);
	const [isExpanded, setIsExpanded] = useState(false);

	const handleToggle = useCallback(
		() => collapseState.toggleFileCollapsed(file.path),
		[collapseState, file.path],
	);
	const handleToggleAll = useCallback(
		() => (isCollapsed ? collapseState.expandAllFiles() : collapseState.collapseAllFiles()),
		[isCollapsed, collapseState],
	);
	const handleToggleExpand = useCallback(() => setIsExpanded((v) => !v), []);
	const handleToggleViewed = useCallback(() => {
		onToggleViewed?.(file.path);
	}, [onToggleViewed, file.path]);

	return (
		<div id={`file-${file.path}`}>
			<FileHeader
				file={file}
				isCollapsed={isCollapsed}
				isExpanded={isExpanded}
				isViewed={isViewed}
				onToggle={handleToggle}
				onToggleAll={handleToggleAll}
				onToggleExpand={handleToggleExpand}
				onToggleViewed={onToggleViewed ? handleToggleViewed : undefined}
			/>
			{!isCollapsed && (
				<PierreDiffViewer
					fileDiff={diff}
					filePath={file.path}
					expandUnchanged={isExpanded}
					allLineRefsByFile={chapterOverlay?.allLineRefsByFile}
					focusedLineRefsByFile={chapterOverlay?.focusedLineRefsByFile}
					focusedKeyChangeId={chapterOverlay?.focusedKeyChangeId ?? null}
					isKeyChangeChecked={chapterOverlay?.isKeyChangeChecked}
					onMarkKeyChangeChecked={chapterOverlay?.onMarkKeyChangeChecked}
					onUnmarkKeyChangeChecked={chapterOverlay?.onUnmarkKeyChangeChecked}
					onFocusKeyChange={chapterOverlay?.onFocusKeyChange}
				/>
			)}
		</div>
	);
}
