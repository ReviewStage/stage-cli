import {
	REVIEWER_STATUS,
	type Reviewer,
	type ReviewerStatus,
	type ReviewUser,
} from "@stagereview/types/pull-request";
import { useMutation } from "@tanstack/react-query";
import {
	Check,
	ChevronDown,
	Circle,
	Loader2,
	type LucideIcon,
	MessageSquare,
	RefreshCw,
	Users,
	X,
} from "lucide-react";
import { useState } from "react";
import { BotBadge } from "@/components/shared/bot-badge";
import { ReviewerAvatars } from "@/components/shared/reviewer-avatars";
import { getUserDisplay } from "@/components/shared/user-utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePullRequestContext } from "@/lib/pull-request-context";
import {
	addReviewerMutationOptions,
	removeReviewerMutationOptions,
} from "@/lib/pull-request-mutations";
import { useReviewerManager } from "@/lib/use-reviewer-manager";
import { cn } from "@/lib/utils";

const STATUS_DESCRIPTIONS: Record<ReviewerStatus, string> = {
	[REVIEWER_STATUS.APPROVED]: "This reviewer approved these changes",
	[REVIEWER_STATUS.CHANGES_REQUESTED]: "This reviewer requested changes",
	[REVIEWER_STATUS.COMMENTED]: "This reviewer left comments",
	[REVIEWER_STATUS.DISMISSED]: "This review was dismissed",
	[REVIEWER_STATUS.PENDING]: "This reviewer hasn't submitted a review yet",
	[REVIEWER_STATUS.REQUESTED]: "Awaiting review from this reviewer",
};

const STATUS_ICONS: Record<ReviewerStatus, { icon: LucideIcon; className: string }> = {
	[REVIEWER_STATUS.APPROVED]: { icon: Check, className: "size-3.5 text-green-600" },
	[REVIEWER_STATUS.CHANGES_REQUESTED]: { icon: X, className: "size-3.5 text-destructive" },
	[REVIEWER_STATUS.COMMENTED]: { icon: MessageSquare, className: "size-3 text-muted-foreground" },
	[REVIEWER_STATUS.DISMISSED]: { icon: Circle, className: "size-3 text-muted-foreground" },
	[REVIEWER_STATUS.PENDING]: { icon: Circle, className: "size-3 text-muted-foreground" },
	[REVIEWER_STATUS.REQUESTED]: { icon: Circle, className: "size-3 text-muted-foreground" },
};

function StatusIcon({ status }: { status: ReviewerStatus }) {
	const { icon: Icon, className } = STATUS_ICONS[status];
	return <Icon className={className} />;
}

interface ReviewerRowProps {
	reviewer: Reviewer;
	owner: string;
	repo: string;
	pullNumber: number;
	onRemoveMutate: (login: string) => void;
	onRemoveError: (login: string) => void;
	invalidatePullRequestQueries: () => void;
}

function ReviewerRow({
	reviewer,
	owner,
	repo,
	pullNumber,
	onRemoveMutate,
	onRemoveError,
	invalidatePullRequestQueries,
}: ReviewerRowProps) {
	const { runId } = usePullRequestContext();
	const removeMutation = useMutation({
		...removeReviewerMutationOptions(runId),
		onMutate: () => onRemoveMutate(reviewer.user.login),
		onSuccess: () => {
			invalidatePullRequestQueries();
			toast.success("Reviewer removed");
		},
		onError: (error) => {
			onRemoveError(reviewer.user.login);
			toast.error(error instanceof Error ? error.message : "Failed to remove reviewer");
		},
	});

	const rerequestMutation = useMutation({
		...addReviewerMutationOptions(runId),
		onSuccess: () => {
			invalidatePullRequestQueries();
			toast.success("Review re-requested");
		},
		onError: (error) => {
			toast.error(error instanceof Error ? error.message : "Failed to re-request review");
		},
	});

	const { isBot, displayName, profileUrl } = getUserDisplay(reviewer.user);
	const isRequested =
		reviewer.status === REVIEWER_STATUS.REQUESTED || reviewer.status === REVIEWER_STATUS.PENDING;
	const hasReviewed =
		reviewer.status === REVIEWER_STATUS.APPROVED ||
		reviewer.status === REVIEWER_STATUS.CHANGES_REQUESTED ||
		reviewer.status === REVIEWER_STATUS.COMMENTED ||
		reviewer.status === REVIEWER_STATUS.DISMISSED;
	const isPending = removeMutation.isPending || rerequestMutation.isPending;

	return (
		<div className="group/row flex items-center justify-between gap-2 py-1.5">
			<div className="flex min-w-0 items-center gap-2">
				<a href={profileUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
					<Avatar className="size-6">
						<AvatarImage src={reviewer.user.avatar_url} alt={reviewer.user.login} />
						<AvatarFallback className="text-[9px]">
							{reviewer.user.login.charAt(0).toUpperCase()}
						</AvatarFallback>
					</Avatar>
				</a>
				<span className="flex min-w-0 items-center gap-1 text-sm">
					<a
						href={profileUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="truncate font-bold text-foreground hover:underline"
					>
						{displayName}
					</a>
					{isBot && <BotBadge className="shrink-0" />}
				</span>
			</div>
			<div className="flex shrink-0 items-center gap-1">
				{!isBot && isRequested && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="hidden size-6 group-hover/row:inline-flex"
								disabled={isPending}
								onClick={() =>
									removeMutation.mutate({
										owner,
										repo,
										number: pullNumber,
										reviewer: reviewer.user.login,
									})
								}
							>
								<X className="size-3" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Remove reviewer</TooltipContent>
					</Tooltip>
				)}
				{!isBot && hasReviewed && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="hidden size-6 group-hover/row:inline-flex"
								disabled={isPending}
								onClick={() =>
									rerequestMutation.mutate({
										owner,
										repo,
										number: pullNumber,
										reviewers: [reviewer.user.login],
									})
								}
							>
								{rerequestMutation.isPending ? (
									<Loader2 className="size-3 animate-spin" />
								) : (
									<RefreshCw className="size-3" />
								)}
							</Button>
						</TooltipTrigger>
						<TooltipContent>Re-request review</TooltipContent>
					</Tooltip>
				)}
				<Tooltip>
					<TooltipTrigger asChild>
						<span className="inline-flex size-6 items-center justify-center">
							<StatusIcon status={reviewer.status} />
						</span>
					</TooltipTrigger>
					<TooltipContent>{STATUS_DESCRIPTIONS[reviewer.status]}</TooltipContent>
				</Tooltip>
			</div>
		</div>
	);
}

interface CollaboratorRowProps {
	user: ReviewUser;
	owner: string;
	repo: string;
	pullNumber: number;
	onSuccess: () => void;
	onAddMutate: (user: ReviewUser) => void;
	onAddError: (login: string) => void;
	invalidatePullRequestQueries: () => void;
}

function CollaboratorRow({
	user,
	owner,
	repo,
	pullNumber,
	onSuccess,
	onAddMutate,
	onAddError,
	invalidatePullRequestQueries,
}: CollaboratorRowProps) {
	const { runId } = usePullRequestContext();
	const addMutation = useMutation({
		...addReviewerMutationOptions(runId),
		onMutate: () => onAddMutate(user),
		onSuccess: () => {
			onSuccess();
			invalidatePullRequestQueries();
			toast.success("Reviewer requested");
		},
		onError: (error) => {
			onAddError(user.login);
			toast.error(error instanceof Error ? error.message : "Failed to add reviewer");
		},
	});

	return (
		<button
			type="button"
			className="flex w-full items-center gap-2 rounded-sm px-1 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
			disabled={addMutation.isPending}
			onClick={() =>
				addMutation.mutate({ owner, repo, number: pullNumber, reviewers: [user.login] })
			}
		>
			<Avatar className="size-5 shrink-0">
				<AvatarImage src={user.avatar_url} alt={user.login} />
				<AvatarFallback className="text-[9px]">{user.login.charAt(0).toUpperCase()}</AvatarFallback>
			</Avatar>
			<span className="truncate">{user.login}</span>
			{addMutation.isPending && <Loader2 className="ml-auto size-3 animate-spin" />}
		</button>
	);
}

export function Reviewers() {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");

	const {
		owner,
		repo,
		pullNumber,
		reviews,
		reviewers,
		collaborators,
		filteredCollaborators,
		onAddMutate,
		onAddError,
		onRemoveMutate,
		onRemoveError,
		invalidatePullRequestQueries,
	} = useReviewerManager({ open, search });

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
					className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-muted-foreground text-sm transition-colors hover:bg-muted/50"
				>
					<Users className="size-3.5 shrink-0" aria-hidden="true" />
					{reviews === null ? (
						<Loader2 className="size-3 animate-spin" />
					) : reviewers.length > 0 ? (
						<ReviewerAvatars reviewers={reviewers} size="md" />
					) : (
						<span className="text-muted-foreground/60 text-xs">Add reviewers</span>
					)}
					<ChevronDown
						className={cn(
							"size-3 text-muted-foreground transition-transform duration-200",
							open && "rotate-180",
						)}
					/>
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-72 p-0">
				<div className="divide-y divide-border">
					<div className="px-4 py-3">
						<h4 className="text-muted-foreground text-sm">Reviewers</h4>
					</div>

					{reviewers.length > 0 && (
						<div className="px-4 py-3">
							{reviewers.map((reviewer) => (
								<ReviewerRow
									key={reviewer.user.login}
									reviewer={reviewer}
									owner={owner}
									repo={repo}
									pullNumber={pullNumber}
									onRemoveMutate={onRemoveMutate}
									onRemoveError={onRemoveError}
									invalidatePullRequestQueries={invalidatePullRequestQueries}
								/>
							))}
						</div>
					)}

					<div className="px-4 py-3">
						<Input
							placeholder="Add reviewers..."
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							className="h-8 text-sm"
						/>
						<div className="mt-2 max-h-48 overflow-y-auto">
							{filteredCollaborators.length > 0 ? (
								filteredCollaborators.map((user) => (
									<CollaboratorRow
										key={user.login}
										user={user}
										owner={owner}
										repo={repo}
										pullNumber={pullNumber}
										onSuccess={() => setSearch("")}
										onAddMutate={onAddMutate}
										onAddError={onAddError}
										invalidatePullRequestQueries={invalidatePullRequestQueries}
									/>
								))
							) : !collaborators ? (
								<div className="flex items-center justify-center py-2">
									<Loader2 className="size-4 animate-spin text-muted-foreground" />
								</div>
							) : search ? (
								<p className="py-2 text-center text-muted-foreground text-xs">
									No matching collaborators
								</p>
							) : null}
						</div>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
