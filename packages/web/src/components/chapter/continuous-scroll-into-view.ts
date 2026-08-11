import type { DiffSide } from "@/lib/diff-types";
import { findRenderedDiffLine } from "./rendered-line-target";

/**
 * Scroll helpers for the continuous chapter view. Unlike the paged view (which
 * scrolls the window), the continuous view lives inside the pull-request
 * layout's contained scroll area, so every helper operates on that explicit
 * scroll container element.
 */

export function getContentTop(element: HTMLElement | null): number {
	if (!element) return 0;
	const contentTop = Number.parseFloat(getComputedStyle(element).getPropertyValue("--content-top"));
	return Number.isFinite(contentTop) ? contentTop : 0;
}

export function alignElementTopToContentTop(scrollContainer: HTMLElement, element: HTMLElement) {
	const contentTop = getContentTop(element);
	const scrollContainerTop = scrollContainer.getBoundingClientRect().top;
	const elementTop = element.getBoundingClientRect().top;
	scrollContainer.scrollTop += elementTop - scrollContainerTop - contentTop;
	scrollContainer.dispatchEvent(new Event("scroll"));
}

export function alignElementCenterInScrollContainer(
	scrollContainer: HTMLElement,
	element: HTMLElement,
) {
	const scrollContainerTop = scrollContainer.getBoundingClientRect().top;
	const elementRect = element.getBoundingClientRect();
	const elementCenter = elementRect.top + elementRect.height / 2;
	const scrollContainerCenter = scrollContainerTop + scrollContainer.clientHeight / 2;
	scrollContainer.scrollTop += elementCenter - scrollContainerCenter;
	scrollContainer.dispatchEvent(new Event("scroll"));
}

interface ScrollToRenderedLineOptions {
	/** File diff container element holding the <diffs-container> web component. */
	container: HTMLElement;
	scrollContainer: HTMLElement;
	side: DiffSide;
	line: number;
	/** Returns false once a newer scroll request supersedes this one. */
	isLatestRequest: () => boolean;
	/**
	 * Registry of active teardown callbacks. Unmount/cancel paths invoke every
	 * registered callback to stop observers immediately instead of waiting for
	 * the 3s safety-net timeout, which would otherwise let a stale observer
	 * latch onto whatever DOM appears in the meantime.
	 */
	pendingDisconnects: Set<() => void>;
}

const SCROLL_TO_LINE_POLL_MS = 100;
const SCROLL_TO_LINE_TIMEOUT_MS = 3000;

/**
 * Center a specific diff line in the scroll container once it is rendered.
 * The line lives inside Pierre's <diffs-container> shadow DOM and may not be
 * rendered yet (collapsed file, async shadow-root attach), so this watches the
 * container until the line appears, then aligns it.
 */
export function scrollToRenderedLine({
	container,
	scrollContainer,
	side,
	line,
	isLatestRequest,
	pendingDisconnects,
}: ScrollToRenderedLineOptions): void {
	const tryScroll = () => {
		// Abort if a newer scroll request has superseded this one.
		if (!isLatestRequest()) return true;

		const diffsContainer = container.querySelector("diffs-container");
		const shadowRoot = diffsContainer?.shadowRoot;
		if (!shadowRoot) return false;

		const lineEl = findRenderedDiffLine(shadowRoot, side, line);
		if (!lineEl) return false;

		// Collapsed file sections stay mounted under `hidden={isCollapsed}`,
		// so the line can be found before React re-renders the uncollapsed
		// state. Wait for the container to become visible before scrolling.
		if (lineEl.offsetParent === null) return false;

		alignElementCenterInScrollContainer(scrollContainer, lineEl);
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
		pendingDisconnects.delete(disconnectAll);
	};
	pendingDisconnects.add(disconnectAll);

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
	observer.observe(container, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ["hidden"],
	});

	const existingShadowRoot = container.querySelector("diffs-container")?.shadowRoot;
	if (existingShadowRoot) {
		attachShadowObserver(existingShadowRoot);
	} else {
		// Pierre attaches the shadow root asynchronously and that doesn't
		// trigger light-DOM mutations, so poll until it appears.
		shadowRootRetryTimer = setInterval(() => {
			if (!isLatestRequest()) {
				disconnectAll();
				return;
			}
			const shadowRoot = container.querySelector("diffs-container")?.shadowRoot;
			if (!shadowRoot) return;
			if (shadowRootRetryTimer) clearInterval(shadowRootRetryTimer);
			shadowRootRetryTimer = null;
			attachShadowObserver(shadowRoot);
			// A hit here is final — leaving the observers armed would let a later
			// shadow mutation snap the reader back to this old target.
			if (tryScroll()) disconnectAll();
		}, SCROLL_TO_LINE_POLL_MS);
	}

	timeoutHandle = setTimeout(disconnectAll, SCROLL_TO_LINE_TIMEOUT_MS);
}
