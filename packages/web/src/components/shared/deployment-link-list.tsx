import type { DeploymentLink } from "@stagereview/types/pull-request";
import { ExternalLink } from "lucide-react";

export function DeploymentLinkList({ deploymentLinks }: { deploymentLinks: DeploymentLink[] }) {
	return (
		<div className="flex flex-col">
			{deploymentLinks.map((link) => (
				<a
					key={link.environment}
					href={link.url}
					target="_blank"
					rel="noopener noreferrer"
					className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent"
				>
					<ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
					<span className="truncate">{link.environment}</span>
				</a>
			))}
		</div>
	);
}
