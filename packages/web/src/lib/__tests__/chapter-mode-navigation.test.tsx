// @vitest-environment happy-dom

import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useMemo } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route as ChaptersLayoutRoute } from "@/app/runs.$runId.chapters";
import { Route as ChaptersIndexRoute } from "@/app/runs.$runId.chapters.index";
import {
	ChapterViewStateProvider,
	usePublishContinuousChapterReader,
} from "../chapter-view-state-context";
import {
	CHAPTER_VIEW_MODE,
	ChapterSettingsProvider,
	useChapterSettings,
} from "../use-chapter-settings";

const readerControl = vi.hoisted(() => ({ scrollTo: (_chapterNumber: number) => {} }));

// The real reader needs the whole data layer; this one publishes the position
// it opened at (like the loading state does) and can be scrolled by the test.
vi.mock("@/routes/continuous-chapters-page", async () => {
	const { useState } = await import("react");
	return {
		ContinuousChaptersPage({ initialChapterNumber }: { initialChapterNumber: number | null }) {
			const [activeChapterNumber, setActiveChapterNumber] = useState(initialChapterNumber ?? 1);
			readerControl.scrollTo = setActiveChapterNumber;
			usePublishContinuousChapterReader(
				useMemo(() => ({ activeChapterNumber, navigateToChapter: null }), [activeChapterNumber]),
			);
			return <div>Continuous reader</div>;
		},
	};
});

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

function Root() {
	return (
		<ChapterSettingsProvider>
			<ChapterViewStateProvider>
				<ModeToggle />
				<Outlet />
			</ChapterViewStateProvider>
		</ChapterSettingsProvider>
	);
}

function ModeToggle() {
	const { setChapterViewMode } = useChapterSettings();
	return (
		<>
			<button type="button" onClick={() => setChapterViewMode(CHAPTER_VIEW_MODE.PAGED)}>
				Page
			</button>
			<button type="button" onClick={() => setChapterViewMode(CHAPTER_VIEW_MODE.CONTINUOUS)}>
				Scroll
			</button>
		</>
	);
}

function createChaptersRouter(initialPath: string) {
	const root = createRootRoute({ component: Root });
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
	const files = createRoute({
		getParentRoute: () => root,
		path: "/runs/$runId/files",
		component: () => <div>Files</div>,
	});
	return createRouter({
		routeTree: root.addChildren([chapters.addChildren([index, detail]), overview, files]),
		history: createMemoryHistory({ initialEntries: [initialPath] }),
	});
}

async function renderInScrollMode(initialPath: string) {
	window.localStorage.setItem("chapter-viewMode", JSON.stringify(CHAPTER_VIEW_MODE.CONTINUOUS));
	const router = createChaptersRouter(initialPath);
	render(<RouterProvider router={router} />);
	await screen.findByText("Continuous reader");
	return router;
}

async function expectPath(router: ReturnType<typeof createChaptersRouter>, pathname: string) {
	await waitFor(() => expect(router.state.location.pathname).toBe(pathname));
}

describe("switching from Scroll to Page", () => {
	it("opens the chapter the reader was on", async () => {
		const router = await renderInScrollMode("/runs/example/chapters");
		act(() => readerControl.scrollTo(3));

		fireEvent.click(screen.getByRole("button", { name: "Page" }));

		await expectPath(router, "/runs/example/chapters/3");
		expect(screen.getByText("Chapter detail")).toBeDefined();
	});

	it("keeps a deep-linked chapter the reader has not moved from", async () => {
		const router = await renderInScrollMode("/runs/example/chapters/4");
		await expectPath(router, "/runs/example/chapters");

		fireEvent.click(screen.getByRole("button", { name: "Page" }));

		await expectPath(router, "/runs/example/chapters/4");
	});

	it("does not resume a reader position from before leaving the chapters tab", async () => {
		const router = await renderInScrollMode("/runs/example/chapters");
		act(() => readerControl.scrollTo(5));

		await act(() => router.navigate({ to: "/runs/$runId/files", params: { runId: "example" } }));
		fireEvent.click(screen.getByRole("button", { name: "Page" }));
		await act(() => router.navigate({ to: "/runs/$runId/chapters", params: { runId: "example" } }));

		await expectPath(router, "/runs/example");
	});

	it("resumes only once, so a later bare chapters link goes to the overview", async () => {
		const router = await renderInScrollMode("/runs/example/chapters");
		act(() => readerControl.scrollTo(2));
		fireEvent.click(screen.getByRole("button", { name: "Page" }));
		await expectPath(router, "/runs/example/chapters/2");

		await act(() => router.navigate({ to: "/runs/$runId/chapters", params: { runId: "example" } }));

		await expectPath(router, "/runs/example");
	});
});
