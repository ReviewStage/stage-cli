import { cn } from "@/lib/utils";

interface LineCountsProps {
	additions: number;
	deletions: number;
	className?: string;
}

export function LineCounts({ additions, deletions, className }: LineCountsProps) {
	if (additions === 0 && deletions === 0) return null;
	return (
		<div className={cn("flex items-center gap-1 font-medium text-[10px] tabular-nums", className)}>
			{additions > 0 && <span className="text-green-600 dark:text-green-500">+{additions}</span>}
			{deletions > 0 && <span className="text-red-600 dark:text-red-500">-{deletions}</span>}
		</div>
	);
}
