import type { Prologue } from "@stagereview/types/prologue";
import type { GitHubPullRequest } from "@stagereview/types/pull-request";
import { useCallback, useState } from "react";
import { PrologueSection } from "@/components/prologue/prologue-section";
import { OverviewColumnHeader } from "@/components/pull-request/overview-column-header";
import { PullRequestBodyCard } from "@/components/pull-request/pull-request-body-card";
import { CopyMarkdownButton } from "@/components/shared/copy-markdown-button";
import { formatPrologueAsMarkdown } from "@/lib/format-prologue-markdown";
import { cn } from "@/lib/utils";

const SIDEBAR_TAB = {
	PROLOGUE: "prologue",
	DESCRIPTION: "description",
} as const;
type SidebarTab = (typeof SIDEBAR_TAB)[keyof typeof SIDEBAR_TAB];

const TAB_CLASS =
	"cursor-pointer rounded-md px-2.5 py-1 font-medium text-[11px] uppercase tracking-wider transition-colors";

interface OverviewSidebarProps {
	prologue: Prologue | null;
	pullRequest: GitHubPullRequest | null;
}

/**
 * Left overview column: a Prologue tab (the imported run's structured prologue)
 * and a Description tab (the detected PR's markdown body). Each tab is shown
 * only when its content exists; the route renders this only when at least one
 * does. Mirrors hosted Stage's PrologueSidebar.
 */
export function OverviewSidebar({ prologue, pullRequest }: OverviewSidebarProps) {
	const hasPrologue = prologue !== null;
	const hasDescription = Boolean(pullRequest?.user && pullRequest.body.trim().length > 0);
	// Default to whichever content exists at mount (the sidebar only renders once at
	// least one does), preferring the prologue. Capturing the initial tab this way —
	// rather than hardcoding Prologue — means a later-arriving tab can't yank the user
	// off the one they're reading: if the PR description loads before the prologue, the
	// view stays on Description instead of jumping to Prologue when it arrives.
	const [activeTab, setActiveTab] = useState<SidebarTab>(() =>
		prologue !== null ? SIDEBAR_TAB.PROLOGUE : SIDEBAR_TAB.DESCRIPTION,
	);

	// Recover to the available tab if the active one ever has no content.
	const resolvedTab: SidebarTab =
		activeTab === SIDEBAR_TAB.DESCRIPTION && !hasDescription
			? SIDEBAR_TAB.PROLOGUE
			: activeTab === SIDEBAR_TAB.PROLOGUE && !hasPrologue
				? SIDEBAR_TAB.DESCRIPTION
				: activeTab;

	const copyPrologue = useCallback(
		() => (prologue ? formatPrologueAsMarkdown(prologue) : null),
		[prologue],
	);

	return (
		<div>
			<OverviewColumnHeader>
				<div className="flex items-center gap-1" role="tablist" aria-label="Overview tabs">
					{hasPrologue && (
						<button
							type="button"
							role="tab"
							aria-selected={resolvedTab === SIDEBAR_TAB.PROLOGUE}
							onClick={() => setActiveTab(SIDEBAR_TAB.PROLOGUE)}
							className={cn(
								TAB_CLASS,
								resolvedTab === SIDEBAR_TAB.PROLOGUE
									? "bg-accent text-foreground"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							Prologue
						</button>
					)}
					{hasDescription && (
						<button
							type="button"
							role="tab"
							aria-selected={resolvedTab === SIDEBAR_TAB.DESCRIPTION}
							onClick={() => setActiveTab(SIDEBAR_TAB.DESCRIPTION)}
							className={cn(
								TAB_CLASS,
								resolvedTab === SIDEBAR_TAB.DESCRIPTION
									? "bg-accent text-foreground"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							Description
						</button>
					)}
				</div>
				{resolvedTab === SIDEBAR_TAB.PROLOGUE && prologue && (
					<CopyMarkdownButton getMarkdown={copyPrologue} label="prologue" />
				)}
			</OverviewColumnHeader>

			{resolvedTab === SIDEBAR_TAB.PROLOGUE && prologue ? (
				<PrologueSection prologue={prologue} />
			) : pullRequest ? (
				<section className="rounded-lg border bg-card p-4">
					<PullRequestBodyCard pullRequest={pullRequest} />
				</section>
			) : null}
		</div>
	);
}
