import type { FileDiffMetadata } from "@pierre/diffs";
import type { FileContent, FileContentsMap } from "@stagereview/types/diff";
import { isImageFile } from "@stagereview/types/image";
import { FileCode } from "lucide-react";
import {
	forwardRef,
	memo,
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { FileHeader } from "@/components/chapter/file-header";
import { PierreDiffViewer } from "@/components/chapter/pierre-diff-viewer";
import { findRenderedDiffLine } from "@/components/chapter/rendered-line-target";
import { ImageDiffViewer } from "@/components/diff/image-diff-viewer";
import type { AnnotatedLineRef, DiffSide, LineRef } from "@/lib/diff-types";
import { buildFullFilePreviewDiff, isFullFilePreview } from "@/lib/full-file-preview";
import { KEYBOARD_SHORTCUTS } from "@/lib/keyboard-shortcuts";
import type { FileDiffEntry } from "@/lib/parse-diff";
import { useDiffSettings } from "@/lib/use-diff-settings";
import { cn } from "@/lib/utils";

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
	/**
	 * Raw per-file contents from the diff response. Used for image files
	 * (base64-encoded binaries) and full-file previews of pure renames, where
	 * the parsed diff carries no line content.
	 */
	fileContents?: FileContentsMap;
	emptyMessage: string;
	viewedPathSet?: ReadonlySet<string>;
	onToggleViewed?: (path: string) => void;
	collapseState: CollapseState;
	chapterOverlay?: ChapterOverlayProps;
	/** The keyboard-focused file, outlined to mark it as the active diff. */
	focusedFilePath?: string;
}

const FILE_DIFF_SECTION_GAP_PX = 16;
const SCROLL_TO_LINE_POLL_MS = 100;
const SCROLL_TO_LINE_TIMEOUT_MS = 3000;
const FILE_MOUNT_TIMEOUT_MS = 3000;

/**
 * Sticky offset for the file headers, set as a CSS variable by the run layout
 * and inherited by every element in the list.
 */
function getContentTop(element: HTMLElement | null): number {
	if (!element) return 0;
	return parseFloat(getComputedStyle(element).getPropertyValue("--content-top") || "0");
}

/**
 * Nearest scrollable ancestor, or `null` when the page itself scrolls. The
 * Files tab and chapter detail page scroll the window; the continuous chapter
 * stream renders inside the pull-request layout's contained scroll area.
 */
export function findScrollParent(element: HTMLElement | null): HTMLElement | null {
	let node = element?.parentElement ?? null;
	while (node) {
		const { overflowY } = getComputedStyle(node);
		if (overflowY === "auto" || overflowY === "scroll") return node;
		node = node.parentElement;
	}
	return null;
}

export const FileDiffList = forwardRef<FileDiffListHandle, FileDiffListProps>(function FileDiffList(
	{
		entries,
		fileContents,
		emptyMessage,
		viewedPathSet,
		onToggleViewed,
		collapseState,
		chapterOverlay,
		focusedFilePath,
	},
	ref,
) {
	const virtuosoRef = useRef<VirtuosoHandle>(null);
	const listRootRef = useRef<HTMLDivElement>(null);
	const scrollRequestRef = useRef(0);
	const pendingDisconnectsRef = useRef<Set<() => void>>(new Set());

	// One binding per page — the list is the single component both the Files tab
	// and the chapter detail page render, mirroring the hosted app's page-level
	// binding (binding inside PierreDiffViewer would fire once per mounted file).
	const { toggleInlineCommentsMinimized } = useDiffSettings();
	useHotkeys(KEYBOARD_SHORTCUTS.TOGGLE_INLINE_COMMENTS.hotkey, toggleInlineCommentsMinimized, {
		preventDefault: true,
		enableOnFormTags: false,
	});

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

		const scrollListToIndex = (index: number) => {
			virtuosoRef.current?.scrollToIndex({
				index,
				align: "start",
				offset: -getContentTop(listRootRef.current),
				behavior: "auto",
			});
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
				const index = entries.findIndex((e) => e.file.path === filePath);
				if (index === -1) return;
				scrollListToIndex(index);
			},
			scrollToLine(filePath: string, side: DiffSide, line: number) {
				cancelPending();
				const index = entries.findIndex((e) => e.file.path === filePath);
				if (index === -1) return;

				const requestToken = scrollRequestRef.current;
				const isLatestRequest = () => scrollRequestRef.current === requestToken;

				if (collapseState.collapsedFiles.has(filePath)) {
					collapseState.toggleFileCollapsed(filePath);
				}

				const existing = document.getElementById(`file-${filePath}`);
				if (existing) {
					runWithContainer(existing, side, line, isLatestRequest);
					return;
				}

				// File is outside Virtuoso's overscan — force-mount it by scrolling the
				// list to the file, then watch document.body for the container to appear.
				// Virtuoso's "auto" behavior is instant, so cancelScrollToLine() can
				// still abort before the file mounts.
				scrollListToIndex(index);

				let bodyTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
				const disconnectBody = () => {
					bodyObserver.disconnect();
					if (bodyTimeoutHandle) clearTimeout(bodyTimeoutHandle);
					pendingDisconnectsRef.current.delete(disconnectBody);
				};
				const bodyObserver = new MutationObserver(() => {
					if (!isLatestRequest()) {
						disconnectBody();
						return;
					}
					const container = document.getElementById(`file-${filePath}`);
					if (container) {
						disconnectBody();
						runWithContainer(container, side, line, isLatestRequest);
					}
				});
				bodyObserver.observe(document.body, { childList: true, subtree: true });
				pendingDisconnectsRef.current.add(disconnectBody);
				bodyTimeoutHandle = setTimeout(disconnectBody, FILE_MOUNT_TIMEOUT_MS);
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
		<div ref={listRootRef}>
			<Virtuoso
				ref={virtuosoRef}
				useWindowScroll
				data={entries}
				computeItemKey={(_, entry) => entry.file.path}
				overscan={{ main: 1000, reverse: 500 }}
				defaultItemHeight={400}
				itemContent={(index, entry) => (
					// The page shell already pads above the list, so the first item
					// carries no gap of its own (matches the pre-virtuoso space-y-4).
					<div style={{ paddingTop: index === 0 ? 0 : FILE_DIFF_SECTION_GAP_PX }}>
						<FileDiffSection
							entry={entry}
							content={resolveFileContent(fileContents, entry)}
							isViewed={viewedPathSet?.has(entry.file.path) ?? false}
							isFocused={entry.file.path === focusedFilePath}
							onToggleViewed={onToggleViewed}
							collapseState={collapseState}
							chapterOverlay={chapterOverlay}
						/>
					</div>
				)}
			/>
		</div>
	);
});

function FileContentUnavailable() {
	return (
		<div className="rounded-b-lg border-x border-b border-border bg-card px-4 py-6 text-center text-muted-foreground text-sm">
			File content unavailable.
		</div>
	);
}

/**
 * Full-side file texts, available only when the diff response's fileContents
 * enriched this diff (isPartial false means the line arrays cover the whole
 * file, not just the patch).
 */
function getFullFileTexts(diff: FileDiffMetadata): { oldText?: string; newText?: string } {
	if (diff.isPartial) return {};
	return {
		oldText: diff.deletionLines.join(""),
		newText: diff.additionLines.join(""),
	};
}

/**
 * Raw contents for an entry, falling back to the pre-rename path so moved and
 * renamed files still resolve their old side.
 */
export function resolveFileContent(
	fileContents: FileContentsMap | undefined,
	entry: FileDiffEntry,
): FileContent | undefined {
	const content = fileContents?.[entry.file.path];
	if (content) return content;
	const oldPath = entry.file.oldPath;
	return oldPath ? fileContents?.[oldPath] : undefined;
}

interface FileDiffSectionProps {
	entry: FileDiffEntry;
	content?: FileContent;
	/**
	 * Container element id; defaults to the Files tab's `file-${path}`
	 * convention. Pass null to render no id (continuous mode locates sections
	 * via data attributes instead, and the same file can appear in several
	 * chapter sections, so per-chapter ids would collide or be ambiguous).
	 */
	containerId?: string | null;
	isViewed: boolean;
	isFocused: boolean;
	onToggleViewed?: (path: string) => void;
	collapseState: CollapseState;
	chapterOverlay?: ChapterOverlayProps;
}

export const FileDiffSection = memo(function FileDiffSection({
	entry,
	content,
	containerId,
	isViewed,
	isFocused,
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

	// A symlink named logo.png is a one-line target-path change, not image
	// data; git marks it with mode 120000, and rendering it as an image would
	// show a broken or misleading picture instead of the link edit.
	const isSymlink = diff.mode === "120000" || diff.prevMode === "120000";
	const isImage = !isSymlink && isImageFile(file.path);
	const isPreviewOnlyFile = isFullFilePreview(entry);
	// Joining the full line arrays is only needed for the two special renderers.
	// The raw content entry wins when present: it covers binary images (base64)
	// and pure renames, which have no parsed diff lines to join.
	const needsFullText = isImage || isPreviewOnlyFile;
	const { oldText, newText } = useMemo(() => {
		if (!needsFullText) return {};
		if (content) {
			return { oldText: content.oldContent ?? undefined, newText: content.newContent ?? undefined };
		}
		return getFullFileTexts(diff);
	}, [needsFullText, content, diff]);
	const previewDiff = useMemo(
		() => (isPreviewOnlyFile ? buildFullFilePreviewDiff(entry, oldText, newText) : undefined),
		[isPreviewOnlyFile, entry, oldText, newText],
	);

	// Track whether the diff content has ever been rendered. Files that start
	// collapsed (deleted files, previously-viewed files) skip rendering until
	// first expanded. Once rendered, we keep the DOM and toggle `hidden` so
	// subsequent collapse/expand is O(1) instead of unmounting/mounting the tree.
	const [hasBeenExpanded, setHasBeenExpanded] = useState(!isCollapsed);
	useEffect(() => {
		if (!isCollapsed) setHasBeenExpanded(true);
	}, [isCollapsed]);

	// When a file collapses while its header is stuck (sticky), the section
	// shrinks and the header would jump to its natural position. Adjust the
	// scroll position so the header stays at the same visual location.
	const containerRef = useRef<HTMLDivElement>(null);
	const wasCollapsedRef = useRef(isCollapsed);

	useLayoutEffect(() => {
		const wasCollapsed = wasCollapsedRef.current;
		wasCollapsedRef.current = isCollapsed;

		if (!isCollapsed || wasCollapsed) return;

		const container = containerRef.current;
		if (!container) return;

		const scrollParent = findScrollParent(container);
		const relativeTop =
			container.getBoundingClientRect().top -
			(scrollParent ? scrollParent.getBoundingClientRect().top : 0);
		const stickyOffset = getContentTop(container);

		if (relativeTop < stickyOffset) {
			if (scrollParent) scrollParent.scrollTop += relativeTop - stickyOffset;
			else window.scrollBy(0, relativeTop - stickyOffset);
		}
	}, [isCollapsed]);

	return (
		<div
			ref={containerRef}
			id={containerId === null ? undefined : (containerId ?? `file-${file.path}`)}
			data-focused-file={isFocused ? "true" : undefined}
			className={cn("rounded-lg", isFocused && "outline-2 outline-primary/70")}
		>
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
			{hasBeenExpanded && (
				<div hidden={isCollapsed}>
					{isImage ? (
						<ImageDiffViewer
							file={file}
							oldText={oldText}
							newText={newText}
							encoding={content?.encoding}
						/>
					) : isPreviewOnlyFile && !previewDiff ? (
						<FileContentUnavailable />
					) : (
						<PierreDiffViewer
							fileDiff={previewDiff ?? diff}
							anchorHunks={previewDiff ? diff.hunks : undefined}
							filePath={file.path}
							// Full-file previews promise the complete file, but Pierre still
							// collapses their single context-only hunk past its unchanged-line
							// threshold — and moved files hide the expand control. Render them
							// permanently expanded instead.
							expandUnchanged={isExpanded || isPreviewOnlyFile}
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
			)}
		</div>
	);
});
