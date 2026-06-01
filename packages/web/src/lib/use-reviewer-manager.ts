import { REVIEWER_STATUS, type Reviewer, type ReviewUser } from "@stagereview/types/pull-request";
import { useCallback, useEffect, useMemo, useState } from "react";
import { filterAndSortReviewers } from "@/components/shared/reviewer-avatars";
import { usePullRequestContext } from "@/lib/pull-request-context";
import { useInvalidatePullRequest } from "@/lib/pull-request-mutations";
import { usePullRequestCollaborators } from "@/lib/use-pull-request";

interface UseReviewerManagerOptions {
	open: boolean;
	search: string;
}

export function useReviewerManager({ open, search }: UseReviewerManagerOptions) {
	const { runId, owner, repo, number, pullRequest, reviews } = usePullRequestContext();
	const invalidatePullRequestQueries = useInvalidatePullRequest(runId);
	const [optimisticAdditions, setOptimisticAdditions] = useState<Map<string, Reviewer>>(
		() => new Map(),
	);
	const [optimisticRemovals, setOptimisticRemovals] = useState<Set<string>>(() => new Set());

	const { data: collaboratorsData } = usePullRequestCollaborators(runId, open);
	const collaborators = collaboratorsData?.collaborators ?? null;

	const serverReviewers = useMemo(() => {
		if (!reviews?.reviewers) return [];
		return filterAndSortReviewers(reviews.reviewers, pullRequest.user?.login);
	}, [reviews?.reviewers, pullRequest.user?.login]);

	// Clear optimistic state once server data reflects the changes.
	useEffect(() => {
		const serverLogins = new Set(serverReviewers.map((r) => r.user.login));
		setOptimisticAdditions((prev) => {
			const next = new Map([...prev].filter(([login]) => !serverLogins.has(login)));
			return next.size === prev.size ? prev : next;
		});
		setOptimisticRemovals((prev) => {
			const next = new Set(
				[...prev].filter((login) => serverLogins.has(login) || optimisticAdditions.has(login)),
			);
			return next.size === prev.size ? prev : next;
		});
	}, [serverReviewers, optimisticAdditions]);

	const reviewers = useMemo(() => {
		const filtered = serverReviewers.filter((r) => !optimisticRemovals.has(r.user.login));
		const additions = [...optimisticAdditions.values()].filter(
			(r) => !optimisticRemovals.has(r.user.login),
		);
		return filterAndSortReviewers([...filtered, ...additions], pullRequest.user?.login);
	}, [serverReviewers, optimisticRemovals, optimisticAdditions, pullRequest.user?.login]);

	const currentReviewerLogins = useMemo(
		() => new Set(reviewers.map((r) => r.user.login)),
		[reviewers],
	);

	const availableCollaborators = useMemo(() => {
		if (!collaborators) return [];
		const authorLogin = pullRequest.user?.login;
		return collaborators.filter(
			(c) => c.type !== "Bot" && c.login !== authorLogin && !currentReviewerLogins.has(c.login),
		);
	}, [collaborators, pullRequest.user?.login, currentReviewerLogins]);

	const filteredCollaborators = useMemo(() => {
		if (!search) return availableCollaborators;
		const queryText = search.toLowerCase();
		return availableCollaborators.filter((c) => c.login.toLowerCase().includes(queryText));
	}, [availableCollaborators, search]);

	const onAddMutate = useCallback((user: ReviewUser) => {
		setOptimisticRemovals((prev) => {
			if (!prev.has(user.login)) return prev;
			const next = new Set(prev);
			next.delete(user.login);
			return next;
		});
		setOptimisticAdditions((prev) => {
			const next = new Map(prev);
			next.set(user.login, { user, status: REVIEWER_STATUS.REQUESTED });
			return next;
		});
	}, []);

	const onAddError = useCallback((login: string) => {
		setOptimisticAdditions((prev) => {
			const next = new Map(prev);
			next.delete(login);
			return next.size === prev.size ? prev : next;
		});
	}, []);

	const onRemoveMutate = useCallback((login: string) => {
		setOptimisticAdditions((prev) => {
			if (!prev.has(login)) return prev;
			const next = new Map(prev);
			next.delete(login);
			return next;
		});
		setOptimisticRemovals((prev) => new Set(prev).add(login));
	}, []);

	const onRemoveError = useCallback((login: string) => {
		setOptimisticRemovals((prev) => {
			if (!prev.has(login)) return prev;
			const next = new Set(prev);
			next.delete(login);
			return next;
		});
	}, []);

	return {
		owner,
		repo,
		pullNumber: number,
		reviews,
		reviewers,
		collaborators,
		filteredCollaborators,
		onAddMutate,
		onAddError,
		onRemoveMutate,
		onRemoveError,
		invalidatePullRequestQueries,
	};
}
