import { ArrowDownToLine, ArrowUpFromLine, Github, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
	type PullCommentsResult,
	type PushCommentsResult,
	useCommentSync,
} from "@/lib/use-comment-sync";

function plural(n: number): string {
	return n === 1 ? "" : "s";
}

function toastPullResult(r: PullCommentsResult): void {
	if (r.pulled === 0) {
		toast.info(
			r.skipped > 0 ? "All PR comments are already imported" : "No review comments on the PR",
		);
		return;
	}
	const extra = r.skipped > 0 ? ` (${r.skipped} already imported)` : "";
	toast.success(`Imported ${r.pulled} comment${plural(r.pulled)} from the PR${extra}`);
}

function toastPushResult(r: PushCommentsResult): void {
	if (r.failed.length > 0) {
		const pushedMsg = r.pushed > 0 ? `${r.pushed} pushed, ` : "";
		toast.error(`${pushedMsg}${r.failed.length} failed`, {
			description: r.failed.map((f) => `${f.filePath}:${f.line} — ${f.message}`).join("\n"),
		});
		return;
	}
	if (r.pushed === 0) {
		toast.info(r.skipped > 0 ? "All comments are already on the PR" : "No local comments to push");
		return;
	}
	const extra = r.skipped > 0 ? ` (${r.skipped} already on the PR)` : "";
	toast.success(`Pushed ${r.pushed} comment${plural(r.pushed)} to the PR${extra}`);
}

function errorMessage(err: unknown, fallback: string): string {
	return err instanceof Error ? err.message : fallback;
}

/**
 * Pull/push controls for syncing the run's comments with its GitHub PR. Only the
 * push path enforces guardrails server-side; both surface their outcome — imported,
 * skipped, or failed — as a toast so the user always sees what happened.
 */
export function CommentSyncMenu({ runId }: { runId: string }) {
	const { pull, push, isPulling, isPushing } = useCommentSync(runId);
	const isBusy = isPulling || isPushing;

	async function handlePull() {
		try {
			toastPullResult(await pull());
		} catch (err) {
			toast.error(errorMessage(err, "Failed to import comments from the PR"));
		}
	}

	async function handlePush() {
		try {
			toastPushResult(await push());
		} catch (err) {
			toast.error(errorMessage(err, "Failed to push comments to the PR"));
		}
	}

	return (
		<DropdownMenu>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<Button
							variant="outline"
							size="sm"
							className="h-7 cursor-pointer px-2"
							aria-label="Sync comments with GitHub"
							disabled={isBusy}
						>
							{isBusy ? (
								<Loader2 className="size-3.5 animate-spin" />
							) : (
								<Github className="size-3.5" />
							)}
							<span className="ml-1 hidden text-xs @7xl:inline">Sync</span>
						</Button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent>Sync comments with GitHub</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onClick={handlePull} disabled={isBusy}>
					<ArrowDownToLine className="size-4" />
					Pull comments from PR
				</DropdownMenuItem>
				<DropdownMenuItem onClick={handlePush} disabled={isBusy}>
					<ArrowUpFromLine className="size-4" />
					Push comments to PR
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
