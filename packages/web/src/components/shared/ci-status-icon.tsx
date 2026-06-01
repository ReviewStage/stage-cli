import type { PullRequestCIStatus } from "@stagereview/types/pull-request";
import { PULL_REQUEST_CI_STATUS } from "@stagereview/types/pull-request";
import { Check, Loader2, X } from "lucide-react";

interface CiStatusIconProps {
	state: PullRequestCIStatus;
	size: "xs" | "sm";
}

export function CiStatusIcon({ state, size }: CiStatusIconProps) {
	const cls = size === "xs" ? "size-3.5" : "size-4";

	switch (state) {
		case PULL_REQUEST_CI_STATUS.SUCCESS:
			return <Check className={`${cls} text-green-500`} />;
		case PULL_REQUEST_CI_STATUS.FAILURE:
			return <X className={`${cls} text-red-500`} />;
		case PULL_REQUEST_CI_STATUS.PENDING:
			return <Loader2 className={`${cls} animate-spin text-yellow-500`} />;
		case PULL_REQUEST_CI_STATUS.NONE:
			return null;
	}
}
