// @vitest-environment happy-dom

import type { Chapter } from "@stagereview/types/chapters";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Route as ChaptersLayoutRoute } from "@/app/runs.$runId.chapters";
import { Route as ChaptersIndexRoute } from "@/app/runs.$runId.chapters.index";
import { ChapterProvider } from "../chapter-context";
import {
	ChapterViewStateProvider,
	useContinuousChapterReader,
} from "../chapter-view-state-context";
import {
	CHAPTER_VIEW_MODE,
	ChapterSettingsProvider,
	useChapterSettings,
} from "../use-chapter-settings";

// Review comments are unrelated to the loading reader's chapter position.
vi.mock("../review-context", () => ({ useReviewContext: () => ({ threads: [] }) }));

beforeEach(() => {
	window.localStorage.clear();
	window.localStorage.setItem("chapter-viewMode", JSON.stringify(CHAPTER_VIEW_MODE.CONTINUOUS));
	vi.stubGlobal(
		"fetch",
		vi.fn(() => new Promise<Response>(() => {})),
	);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function makeChapter(order: number): Chapter {
	return {
		id: `database-${order}`,
		externalId: `chapter-${order}`,
		order,
		title: `Chapter ${order + 1}`,
		summary: "",
		hunkRefs: [],
		keyChanges: [],
		riskLevel: null,
		riskReasons: [],
	};
}

function ReaderControls() {
	const { setChapterViewMode } = useChapterSettings();
	const reader = useContinuousChapterReader();
	return (
		<>
			<output aria-label="Reader position">{reader?.activeChapterNumber}</output>
			<button type="button" onClick={() => setChapterViewMode(CHAPTER_VIEW_MODE.PAGED)}>
				Page
			</button>
		</>
	);
}

function createLoadingRouter(client: QueryClient, initialChapterNumber: number) {
	const root = createRootRoute({
		component: () => (
			<QueryClientProvider client={client}>
				<ChapterSettingsProvider>
					<ChapterViewStateProvider>
						<ChapterProvider runId="example">
							<ReaderControls />
							<Outlet />
						</ChapterProvider>
					</ChapterViewStateProvider>
				</ChapterSettingsProvider>
			</QueryClientProvider>
		),
	});
	const chapters = createRoute({
		getParentRoute: () => root,
		path: "/runs/$runId/chapters",
		component: ChaptersLayoutRoute.options.component,
	});
	const index = createRoute({
		getParentRoute: () => chapters,
		path: "/",
		component: ChaptersIndexRoute.options.component,
	});
	const detail = createRoute({
		getParentRoute: () => chapters,
		path: "$chapterNumber",
		component: () => <div>Chapter detail</div>,
	});
	const overview = createRoute({
		getParentRoute: () => root,
		path: "/runs/$runId",
		component: () => <div>Run overview</div>,
	});
	return createRouter({
		routeTree: root.addChildren([chapters.addChildren([index, detail]), overview]),
		history: createMemoryHistory({
			initialEntries: [`/runs/example/chapters/${initialChapterNumber}`],
		}),
	});
}

it.each([
	999, 2,
])("resumes chapter %s within the available chapters while the diff is still loading", async (initialChapterNumber) => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const router = createLoadingRouter(client, initialChapterNumber);
	render(<RouterProvider router={router} />);
	await waitFor(() => {
		expect(screen.getByRole("status", { name: "Reader position" }).textContent).toBe(
			String(initialChapterNumber),
		);
	});
	// Chapter metadata arrives before the gated diff request.
	act(() => {
		client.setQueryData(["chapters", "example"], {
			run: { id: "example", repoName: "fixture" },
			chapters: [makeChapter(0), makeChapter(1), makeChapter(2)],
		});
	});
	const expectedChapterNumber = initialChapterNumber === 999 ? 3 : 2;
	await waitFor(() => {
		expect(screen.getByRole("status", { name: "Reader position" }).textContent).toBe(
			String(expectedChapterNumber),
		);
	});

	fireEvent.click(screen.getByRole("button", { name: "Page" }));

	await waitFor(() => {
		expect(router.state.location.pathname).toBe(`/runs/example/chapters/${expectedChapterNumber}`);
	});
	expect(screen.getByText("Chapter detail")).toBeDefined();
	client.clear();
});
