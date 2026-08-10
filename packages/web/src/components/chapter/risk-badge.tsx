import { RISK_LABELS, type RiskLevel } from "@stagereview/types/chapters";
import { AlertCircle } from "lucide-react";
import { forwardRef } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const RISK_COLORS: Record<RiskLevel, string> = {
	high: "bg-red-500/15 text-red-700 dark:text-red-400",
	medium: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
	low: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};

const RISK_ICON_COLORS: Record<RiskLevel, string> = {
	high: "text-red-500",
	medium: "text-amber-500",
	low: "text-emerald-500",
};

interface RiskBadgeProps {
	level: RiskLevel;
	className?: string;
}

export function RiskBadge({ level, className }: RiskBadgeProps) {
	const label = RISK_LABELS[level];

	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold text-[0.625rem] leading-none",
				RISK_COLORS[level],
				className,
			)}
		>
			{label} risk
		</span>
	);
}

interface RiskChipProps {
	level: RiskLevel;
	reasons: string[];
	className?: string;
}

const ChipTrigger = forwardRef<
	HTMLButtonElement,
	RiskBadgeProps & React.ComponentPropsWithoutRef<"button">
>(({ level, className, ...props }, ref) => {
	const label = RISK_LABELS[level];
	return (
		<button
			ref={ref}
			type="button"
			className={cn(
				"inline-flex cursor-default items-center gap-1 rounded-full px-2 py-0.5 font-medium text-[0.6875rem] leading-tight",
				RISK_COLORS[level],
				className,
			)}
			{...props}
		>
			{label} risk
		</button>
	);
});

export function RiskChip({ level, reasons, className }: RiskChipProps) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<ChipTrigger level={level} className={className} />
			</TooltipTrigger>
			{reasons.length > 0 && (
				<TooltipContent side="bottom" align="start" className="max-w-72 p-0">
					<div className="p-2.5">
						<ul className="space-y-1.5">
							{reasons.map((reason) => (
								<li key={reason} className="flex items-start gap-2 text-sm">
									<AlertCircle className={cn("mt-0.5 size-3 shrink-0", RISK_ICON_COLORS[level])} />
									<span className="text-popover-foreground/80">{reason}</span>
								</li>
							))}
						</ul>
					</div>
				</TooltipContent>
			)}
		</Tooltip>
	);
}
