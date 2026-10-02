// @vitest-environment happy-dom

import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, waitFor } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Route as ChaptersIndexRoute } from "@/app/runs.$runId.chapters.index";
import { ChapterViewStateProvider, useChapterViewState } from "../chapter-view-state-context";

afterEach(cleanup);

function createNavigationTest(activeChapterNumber: number | null) {
	function Layout() {
		return (
			<ChapterViewStateProvider>
				<ReaderState />
			</ChapterViewStateProvider>
		);
	}
	function ReaderState() {
		const state = useChapterViewState();
		const setActive = state?.setActiveContinuousChapterNumber;
		useLayoutEffect(() => {
			if (activeChapterNumber !== null) setActive?.(activeChapterNumber);
		}, [setActive]);
		return <Outlet />;
	}
	const root = createRootRoute({ component: Layout });
	const index = createRoute({
		getParentRoute: () => root,
		path: "/runs/$runId/chapters/",
		component: ChaptersIndexRoute.options.component,
	});
	const detail = createRoute({
		getParentRoute: () => root,
		path: "/runs/$runId/chapters/$chapterNumber",
		component: () => <div>Chapter detail</div>,
	});
	const overview = createRoute({
		getParentRoute: () => root,
		path: "/runs/$runId",
		component: () => <div>Run overview</div>,
	});
	return createRouter({
		routeTree: root.addChildren([index, detail, overview]),
		history: createMemoryHistory({ initialEntries: ["/runs/example/chapters"] }),
	});
}

describe("leaving the continuous reader", () => {
	it("keeps the active chapter when Page mode mounts the bare chapters redirect", async () => {
		const router = createNavigationTest(3);
		render(<RouterProvider router={router} />);

		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/runs/example/chapters/3");
		});
	});

	it("keeps the overview redirect when there is no continuous reader state", async () => {
		const router = createNavigationTest(null);
		render(<RouterProvider router={router} />);

		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/runs/example");
		});
	});
});
