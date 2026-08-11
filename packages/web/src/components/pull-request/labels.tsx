import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2, Tag, X } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePullRequestContext } from "@/lib/pull-request-context";
import {
	addLabelsMutationOptions,
	type GitHubLabel,
	pullRequestLabelsQueryOptions,
	removeLabelMutationOptions,
	repositoryLabelsQueryOptions,
	useInvalidatePullRequest,
} from "@/lib/pull-request-mutations";
import { GITHUB_REVIEW_STATUS, useReview } from "@/lib/use-review";
import { cn } from "@/lib/utils";

// ─── Label chip ─────────────────────────────────────────────────────────────────

const GITHUB_LABEL_LIGHTNESS_THRESHOLD = 0.453;
const GITHUB_LABEL_DARK_TEXT = "#24292f";
const GITHUB_LABEL_LIGHT_TEXT = "#ffffff";

interface LabelChipStyle extends CSSProperties {
	"--label-bg-light"?: string;
	"--label-border-light"?: string;
	"--label-text-light"?: string;
	"--label-bg-dark"?: string;
	"--label-border-dark"?: string;
	"--label-text-dark"?: string;
}

function normalizeGitHubLabelColor(color: string | null | undefined) {
	const normalized = color?.trim().replace(/^#/, "");
	if (!normalized || !/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
	return normalized;
}

function getGitHubLabelTextColor(hexColor: string) {
	const red = Number.parseInt(hexColor.slice(0, 2), 16);
	const green = Number.parseInt(hexColor.slice(2, 4), 16);
	const blue = Number.parseInt(hexColor.slice(4, 6), 16);
	const perceivedLightness = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
	return perceivedLightness > GITHUB_LABEL_LIGHTNESS_THRESHOLD
		? GITHUB_LABEL_DARK_TEXT
		: GITHUB_LABEL_LIGHT_TEXT;
}

function getLabelChipStyle(color: string | null | undefined): LabelChipStyle | undefined {
	const hexColor = normalizeGitHubLabelColor(color);
	if (!hexColor) return undefined;
	const backgroundColor = `#${hexColor}`;
	return {
		"--label-bg-light": backgroundColor,
		"--label-border-light": backgroundColor,
		"--label-text-light": getGitHubLabelTextColor(hexColor),
		"--label-bg-dark": `${backgroundColor}20`,
		"--label-border-dark": `${backgroundColor}40`,
		"--label-text-dark": backgroundColor,
	};
}

export function LabelChip({ name, color }: { name: string; color?: string | null }) {
	const style = getLabelChipStyle(color);

	return (
		<span
			className={cn(
				"inline-flex max-w-[120px] truncate rounded-full border px-2 py-0.5 font-medium text-[0.6875rem] leading-tight",
				style &&
					"border-[var(--label-border-light)] bg-[var(--label-bg-light)] text-[var(--label-text-light)] dark:border-[var(--label-border-dark)] dark:bg-[var(--label-bg-dark)] dark:text-[var(--label-text-dark)]",
			)}
			style={style}
		>
			{name}
		</span>
	);
}

// ─── Label manager ──────────────────────────────────────────────────────────────

interface UseLabelManagerOptions {
	open: boolean;
	search: string;
}

function sortLabels(labels: GitHubLabel[]) {
	return [...labels].sort((a, b) => a.name.localeCompare(b.name));
}

function useLabelManager({ open, search }: UseLabelManagerOptions) {
	const { runId, owner, repo, number } = usePullRequestContext();
	// Labels are PR metadata with no diff coordinates, so unlike review comments they
	// only need GitHub to be reachable — not a fresh diff anchor: a stale or
	// working-tree run can still manage labels.
	const { github } = useReview(runId);
	const canApprove = github === GITHUB_REVIEW_STATUS.AVAILABLE;
	const invalidatePullRequestQueries = useInvalidatePullRequest(runId);
	const [optimisticAdditions, setOptimisticAdditions] = useState<Map<string, GitHubLabel>>(
		() => new Map(),
	);
	const [optimisticRemovals, setOptimisticRemovals] = useState<Set<string>>(() => new Set());
	const [pendingAdditions, setPendingAdditions] = useState<Set<string>>(() => new Set());

	// Stack navigation swaps runs while this header stays mounted; optimistic
	// state from the previous PR must not bleed into the next one. Render-time
	// state adjustment per React's derived-state guidance.
	const [stateOwner, setStateOwner] = useState({ runId, number });
	if (stateOwner.runId !== runId || stateOwner.number !== number) {
		setStateOwner({ runId, number });
		setOptimisticAdditions(new Map());
		setOptimisticRemovals(new Set());
		setPendingAdditions(new Set());
	}

	// The CLI's PR wire shape has no labels, so they come from the labels route.
	const { data: currentLabels } = useQuery({
		...pullRequestLabelsQueryOptions(runId, number),
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	const { data: repositoryLabels, isError: repositoryLabelsError } = useQuery({
		...repositoryLabelsQueryOptions(runId),
		enabled: open && canApprove,
		staleTime: 5 * 60 * 1000,
	});

	const serverLabels = useMemo(() => sortLabels(currentLabels ?? []), [currentLabels]);

	useEffect(() => {
		const serverNames = new Set(serverLabels.map((label) => label.name));
		setOptimisticAdditions((prev) => {
			const next = new Map([...prev].filter(([name]) => !serverNames.has(name)));
			return next.size === prev.size ? prev : next;
		});
		setOptimisticRemovals((prev) => {
			const next = new Set(
				[...prev].filter((name) => serverNames.has(name) || optimisticAdditions.has(name)),
			);
			return next.size === prev.size ? prev : next;
		});
		setPendingAdditions((prev) => {
			const next = new Set([...prev].filter((name) => !serverNames.has(name)));
			return next.size === prev.size ? prev : next;
		});
	}, [serverLabels, optimisticAdditions]);

	const labels = useMemo(() => {
		const filtered = serverLabels.filter((label) => !optimisticRemovals.has(label.name));
		const filteredNames = new Set(filtered.map((label) => label.name));
		const additions = [...optimisticAdditions.values()].filter(
			(label) => !optimisticRemovals.has(label.name) && !filteredNames.has(label.name),
		);
		return sortLabels([...filtered, ...additions]);
	}, [serverLabels, optimisticRemovals, optimisticAdditions]);

	const currentLabelNames = useMemo(() => new Set(labels.map((label) => label.name)), [labels]);

	const availableLabels = useMemo(() => {
		if (!repositoryLabels) return [];
		return repositoryLabels.filter(
			(label) => !currentLabelNames.has(label.name) && !optimisticRemovals.has(label.name),
		);
	}, [repositoryLabels, currentLabelNames, optimisticRemovals]);

	const filteredRepositoryLabels = useMemo(() => {
		if (!search) return availableLabels;
		const query = search.toLowerCase();
		return availableLabels.filter(
			(label) =>
				label.name.toLowerCase().includes(query) ||
				Boolean(label.description?.toLowerCase().includes(query)),
		);
	}, [availableLabels, search]);

	const onAddMutate = useCallback((label: GitHubLabel) => {
		setOptimisticRemovals((prev) => {
			if (!prev.has(label.name)) return prev;
			const next = new Set(prev);
			next.delete(label.name);
			return next;
		});
		setOptimisticAdditions((prev) => {
			const next = new Map(prev);
			next.set(label.name, label);
			return next;
		});
		setPendingAdditions((prev) => new Set(prev).add(label.name));
	}, []);

	const onAddSuccess = useCallback((name: string) => {
		setPendingAdditions((prev) => {
			if (!prev.has(name)) return prev;
			const next = new Set(prev);
			next.delete(name);
			return next;
		});
	}, []);

	const onAddError = useCallback((name: string) => {
		setPendingAdditions((prev) => {
			if (!prev.has(name)) return prev;
			const next = new Set(prev);
			next.delete(name);
			return next;
		});
		setOptimisticAdditions((prev) => {
			const next = new Map(prev);
			next.delete(name);
			return next.size === prev.size ? prev : next;
		});
	}, []);

	const onRemoveMutate = useCallback((name: string) => {
		setOptimisticAdditions((prev) => {
			if (!prev.has(name)) return prev;
			const next = new Map(prev);
			next.delete(name);
			return next;
		});
		setOptimisticRemovals((prev) => new Set(prev).add(name));
	}, []);

	const onRemoveError = useCallback((name: string) => {
		setOptimisticRemovals((prev) => {
			if (!prev.has(name)) return prev;
			const next = new Set(prev);
			next.delete(name);
			return next;
		});
	}, []);

	return {
		runId,
		owner,
		repo,
		pullNumber: number,
		labels,
		canApprove,
		repositoryLabels: repositoryLabels ?? null,
		repositoryLabelsError,
		filteredRepositoryLabels,
		pendingAdditions,
		onAddMutate,
		onAddSuccess,
		onAddError,
		onRemoveMutate,
		onRemoveError,
		invalidatePullRequestQueries,
	};
}

// ─── Labels popover ─────────────────────────────────────────────────────────────

interface CurrentLabelRowProps {
	label: GitHubLabel;
	runId: string;
	owner: string;
	repo: string;
	pullNumber: number;
	isPendingAddition: boolean;
	onRemoveMutate: (name: string) => void;
	onRemoveError: (name: string) => void;
	invalidatePullRequestQueries: (context?: { mutatedRunId: string }) => void;
}

function CurrentLabelRow({
	label,
	runId,
	owner,
	repo,
	pullNumber,
	isPendingAddition,
	onRemoveMutate,
	onRemoveError,
	invalidatePullRequestQueries,
}: CurrentLabelRowProps) {
	const removeMutation = useMutation({
		...removeLabelMutationOptions(runId),
		onMutate: () => {
			onRemoveMutate(label.name);
			return { mutatedRunId: runId };
		},
		onSuccess: (_data, _variables, ctx) => {
			invalidatePullRequestQueries(ctx);
			toast.success("Label removed");
		},
		onError: () => {
			onRemoveError(label.name);
			toast.error("Failed to remove label");
		},
	});

	return (
		<div className="group/row flex items-center justify-between gap-2 py-1.5">
			<LabelChip name={label.name} color={label.color} />
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						className="size-6 opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100"
						disabled={removeMutation.isPending || isPendingAddition}
						aria-label={isPendingAddition ? "Adding label" : "Remove label"}
						onClick={() =>
							removeMutation.mutate({
								owner,
								repo,
								number: pullNumber,
								label: label.name,
							})
						}
					>
						{removeMutation.isPending || isPendingAddition ? (
							<Loader2 className="size-3 animate-spin" />
						) : (
							<X className="size-3" />
						)}
					</Button>
				</TooltipTrigger>
				<TooltipContent>{isPendingAddition ? "Adding label" : "Remove label"}</TooltipContent>
			</Tooltip>
		</div>
	);
}

interface RepositoryLabelRowProps {
	label: GitHubLabel;
	runId: string;
	owner: string;
	repo: string;
	pullNumber: number;
	onSuccess: () => void;
	onAddMutate: (label: GitHubLabel) => void;
	onAddSuccess: (name: string) => void;
	onAddError: (name: string) => void;
	invalidatePullRequestQueries: (context?: { mutatedRunId: string }) => void;
}

function RepositoryLabelRow({
	label,
	runId,
	owner,
	repo,
	pullNumber,
	onSuccess,
	onAddMutate,
	onAddSuccess,
	onAddError,
	invalidatePullRequestQueries,
}: RepositoryLabelRowProps) {
	const addMutation = useMutation({
		...addLabelsMutationOptions(runId),
		onMutate: () => {
			onAddMutate(label);
			return { mutatedRunId: runId };
		},
		onSuccess: (_data, _variables, ctx) => {
			onAddSuccess(label.name);
			onSuccess();
			invalidatePullRequestQueries(ctx);
			toast.success("Label added");
		},
		onError: () => {
			onAddError(label.name);
			toast.error("Failed to add label");
		},
	});

	return (
		<button
			type="button"
			className="flex w-full items-center gap-2 rounded-sm px-1 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
			disabled={addMutation.isPending}
			onClick={() =>
				addMutation.mutate({
					owner,
					repo,
					number: pullNumber,
					labels: [label.name],
				})
			}
		>
			<LabelChip name={label.name} color={label.color} />
			{addMutation.isPending && <Loader2 className="ml-auto size-3 animate-spin" />}
		</button>
	);
}

function LabelTriggerContent({
	labels,
	canApprove,
}: {
	labels: GitHubLabel[];
	canApprove: boolean;
}) {
	return (
		<>
			<Tag className="size-3.5 shrink-0" aria-hidden="true" />
			{labels.length > 0 ? (
				<div className="flex min-w-0 items-center gap-1">
					{labels.slice(0, 2).map((label) => (
						<LabelChip key={label.id} name={label.name} color={label.color} />
					))}
					{labels.length > 2 && (
						<span className="text-[0.6875rem] text-muted-foreground">+{labels.length - 2}</span>
					)}
				</div>
			) : (
				<span className="text-muted-foreground/60 text-xs">
					{canApprove ? "Add labels" : "No labels"}
				</span>
			)}
		</>
	);
}

export function Labels() {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const {
		runId,
		owner,
		repo,
		pullNumber,
		labels,
		canApprove,
		repositoryLabels,
		repositoryLabelsError,
		filteredRepositoryLabels,
		pendingAdditions,
		onAddMutate,
		onAddSuccess,
		onAddError,
		onRemoveMutate,
		onRemoveError,
		invalidatePullRequestQueries,
	} = useLabelManager({ open, search });

	const triggerContent = <LabelTriggerContent labels={labels} canApprove={canApprove} />;

	if (!canApprove) {
		return (
			<div className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-muted-foreground text-sm">
				{triggerContent}
			</div>
		);
	}

	return (
		<Popover
			open={open}
			onOpenChange={(newOpen) => {
				setOpen(newOpen);
				if (!newOpen) setSearch("");
			}}
		>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-muted-foreground text-sm transition-colors hover:bg-muted/50"
				>
					{triggerContent}
					<ChevronDown
						className={cn(
							"size-3 text-muted-foreground transition-transform duration-200",
							open && "rotate-180",
						)}
					/>
				</button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="max-h-(--radix-popover-content-available-height) w-72 overflow-y-auto scrollbar-thin p-0"
			>
				<div className="divide-y divide-border">
					<div className="px-4 py-3">
						<h4 className="text-muted-foreground text-sm">Labels</h4>
					</div>

					{labels.length > 0 && (
						<div className="px-4 py-3">
							{labels.map((label) => (
								<CurrentLabelRow
									key={label.id}
									label={label}
									runId={runId}
									owner={owner}
									repo={repo}
									pullNumber={pullNumber}
									isPendingAddition={pendingAdditions.has(label.name)}
									onRemoveMutate={onRemoveMutate}
									onRemoveError={onRemoveError}
									invalidatePullRequestQueries={invalidatePullRequestQueries}
								/>
							))}
						</div>
					)}

					<div className="px-4 py-3">
						<Input
							aria-label="Filter labels"
							placeholder="Add labels..."
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							className="h-8 text-sm"
						/>
						<div className="mt-2 max-h-48 overflow-y-auto">
							{filteredRepositoryLabels.length > 0 ? (
								filteredRepositoryLabels.map((label) => (
									<RepositoryLabelRow
										key={label.id}
										label={label}
										runId={runId}
										owner={owner}
										repo={repo}
										pullNumber={pullNumber}
										onSuccess={() => setSearch("")}
										onAddMutate={onAddMutate}
										onAddSuccess={onAddSuccess}
										onAddError={onAddError}
										invalidatePullRequestQueries={invalidatePullRequestQueries}
									/>
								))
							) : repositoryLabelsError ? (
								<p className="py-2 text-center text-muted-foreground text-xs">
									Unable to load labels
								</p>
							) : !repositoryLabels ? (
								<div className="flex items-center justify-center py-2">
									<Loader2 className="size-4 animate-spin text-muted-foreground" />
								</div>
							) : search ? (
								<p className="py-2 text-center text-muted-foreground text-xs">No matching labels</p>
							) : repositoryLabels.length === 0 ? (
								<p className="py-2 text-center text-muted-foreground text-xs">
									This repository has no labels
								</p>
							) : (
								<p className="py-2 text-center text-muted-foreground text-xs">
									All repository labels are already applied
								</p>
							)}
						</div>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
