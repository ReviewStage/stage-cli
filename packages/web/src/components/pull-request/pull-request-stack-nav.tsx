import type { PullRequestStackEntry } from "@stagereview/types";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { Check, ExternalLink, GitPullRequest, GitPullRequestDraft, Layers } from "lucide-react";
import { useCallback } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { KEYBOARD_SHORTCUTS } from "@/lib/keyboard-shortcuts";
import { usePullRequestContext } from "@/lib/pull-request-context";
import { CHAPTER_VIEW_MODE, useChapterSettings } from "@/lib/use-chapter-settings";
import { usePullRequestStack } from "@/lib/use-pull-request-stack";
import { cn } from "@/lib/utils";

// Vendored from hosted Stage's `pull-request-stack-nav.tsx` (final state,
// #1049 + #1052), with hosted's by-number page navigation adapted to the CLI's
// one-PR-per-run model: a stack sibling with a local run opens that run
// (keeping the reviewer on their current tab), and one without a run opens the
// PR on GitHub like the header's other external affordances.

/**
 * Surfaces the stack a pull request belongs to and lets the reviewer jump
 * between its PRs without losing the thread. The stack is derived server-side
 * from open base→head branch relationships; this only renders when the current
 * PR is part of a stack (two or more connected open PRs).
 */
export function PullRequestStackNav() {
	const { runId, owner, repo, number } = usePullRequestContext();
	const navigate = useNavigate();
	const location = useLocation();
	const { chapterViewMode } = useChapterSettings();

	const { data } = usePullRequestStack(runId, number);

	const entries = data?.stack ?? [];
	const currentIndex = entries.findIndex((entry) => entry.isCurrent);
	// The stack is ordered base → tip, so a lower index sits closer to the base.
	const towardBase = currentIndex > 0 ? entries[currentIndex - 1] : undefined;
	const towardTip =
		currentIndex >= 0 && currentIndex < entries.length - 1 ? entries[currentIndex + 1] : undefined;

	const goTo = useCallback(
		(entry: PullRequestStackEntry) => {
			// A stack member without a local run has no run page to land on — the
			// CLI reviews one PR per run — so it opens on GitHub instead.
			if (entry.runId === null) {
				window.open(
					`https://github.com/${owner}/${repo}/pull/${entry.number}`,
					"_blank",
					"noopener,noreferrer",
				);
				return;
			}
			// Keep the reviewer on their current tab (files / activity / chapters)
			// when hopping between PRs, instead of dropping them on the default view.
			const subroute = location.pathname.split(`/runs/${runId}`)[1] ?? "";
			const params = { runId: entry.runId };
			if (subroute.startsWith("/files")) {
				navigate({ to: "/runs/$runId/files", params });
			} else if (subroute.startsWith("/activity")) {
				navigate({ to: "/runs/$runId/activity", params });
			} else if (subroute.startsWith("/chapters")) {
				// Paged mode redirects the bare /chapters URL to the overview, so a
				// paged hop must land on a chapter detail route; the sibling's first
				// chapter always exists. Continuous mode owns the bare URL.
				if (chapterViewMode === CHAPTER_VIEW_MODE.PAGED) {
					navigate({
						to: "/runs/$runId/chapters/$chapterNumber",
						params: { ...params, chapterNumber: "1" },
					});
				} else {
					navigate({ to: "/runs/$runId/chapters", params });
				}
			} else {
				navigate({ to: "/runs/$runId", params });
			}
		},
		[navigate, owner, repo, runId, location.pathname, chapterViewMode],
	);

	// Gate each shortcut on a live target so the handlers aren't registered on
	// every PR view — only when this PR is in a stack and that direction has
	// somewhere to go.
	useHotkeys(
		KEYBOARD_SHORTCUTS.PREV_IN_STACK.hotkey,
		() => towardBase && goTo(towardBase),
		{ ...KEYBOARD_SHORTCUTS.PREV_IN_STACK.hotkeyOptions, enabled: Boolean(towardBase) },
		[towardBase, goTo],
	);
	useHotkeys(
		KEYBOARD_SHORTCUTS.NEXT_IN_STACK.hotkey,
		() => towardTip && goTo(towardTip),
		{ ...KEYBOARD_SHORTCUTS.NEXT_IN_STACK.hotkeyOptions, enabled: Boolean(towardTip) },
		[towardTip, goTo],
	);

	if (entries.length < 2 || currentIndex < 0) return null;

	return (
		<>
			<div className="flex shrink-0 items-center gap-1">
				<Popover>
					<PopoverTrigger asChild>
						<Button variant="outline" size="sm" className="h-7 gap-1.5 rounded-md px-2">
							<Layers className="size-3.5" aria-hidden="true" />
							Stack
							<span className="text-muted-foreground tabular-nums">
								{currentIndex + 1}/{entries.length}
							</span>
						</Button>
					</PopoverTrigger>
					<PopoverContent
						className="scrollbar-thin max-h-(--radix-popover-content-available-height) w-80 overflow-y-auto p-1"
						align="start"
						collisionPadding={12}
					>
						<div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
							{entries.length} pull requests
						</div>
						<ol className="flex flex-col">
							{/* Render tip first so the list reads top-down like a stack of branches. */}
							{[...entries].reverse().map((entry) => (
								<li key={entry.number}>
									<button
										type="button"
										disabled={entry.isCurrent}
										onClick={() => goTo(entry)}
										className={cn(
											"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
											entry.isCurrent
												? "bg-accent text-accent-foreground"
												: "cursor-pointer hover:bg-muted/80",
										)}
									>
										{/* Stack entries are always open PRs (the server excludes closed
										    ones), so draft is the only status the icon needs to vary on. */}
										{entry.isDraft ? (
											<GitPullRequestDraft
												className="size-3.5 shrink-0 text-muted-foreground"
												aria-hidden="true"
											/>
										) : (
											<GitPullRequest
												className="size-3.5 shrink-0 text-green-600"
												aria-hidden="true"
											/>
										)}
										<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
											#{entry.number}
										</span>
										<span className="min-w-0 flex-1 truncate">{entry.title}</span>
										{entry.isCurrent && (
											<Check
												className="size-3.5 shrink-0 text-muted-foreground"
												aria-hidden="true"
											/>
										)}
										{/* No local run for this PR — signal that it opens on GitHub. */}
										{!entry.isCurrent && entry.runId === null && (
											<ExternalLink
												className="size-3 shrink-0 text-muted-foreground"
												aria-hidden="true"
											/>
										)}
									</button>
								</li>
							))}
						</ol>
					</PopoverContent>
				</Popover>
			</div>
			<span className="mx-0.5 h-3 w-px shrink-0 bg-border" />
		</>
	);
}
