import type { ReactNode } from "react";
import { StatusBadge } from "@/components/shared/status-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const SIZE_CONFIG = {
	sm: { avatar: "size-4" },
	md: { avatar: "size-5" },
} as const;

export type AvatarStackSize = keyof typeof SIZE_CONFIG;

const MAX_VISIBLE = 3;

interface AvatarStackItem {
	key: string;
	avatarUrl: string;
	alt: string;
	tooltip?: string;
	badge?: ReactNode;
}

interface AvatarStackProps {
	items: AvatarStackItem[];
	size?: AvatarStackSize;
	/** Number of extra items not represented in `items` (e.g. orphan CI checks). */
	overflowCount?: number;
	hoverSpread?: boolean;
	className?: string;
}

export function AvatarStack({
	items,
	size = "sm",
	overflowCount = 0,
	hoverSpread = false,
	className,
}: AvatarStackProps) {
	if (items.length === 0) return null;

	const config = SIZE_CONFIG[size];
	const visible = items.slice(0, MAX_VISIBLE);
	const totalOverflow = overflowCount + Math.max(0, items.length - MAX_VISIBLE);

	const groupClass = hoverSpread ? "group/avatar-stack" : undefined;

	return (
		<div className={cn("flex items-center", groupClass, className)}>
			{visible.map((item, index) => {
				const avatarSpan = (
					<StatusBadge
						key={item.key}
						badge={item.badge}
						size={size}
						className={cn(
							index > 0 && "-ml-1.5",
							hoverSpread &&
								index > 0 &&
								"transition-[margin] duration-200 ease-in-out group-hover/avatar-stack:ml-0.5",
						)}
						style={{ zIndex: visible.length - index }}
					>
						<img
							src={item.avatarUrl}
							alt={item.alt}
							className={cn(config.avatar, "rounded-full")}
						/>
					</StatusBadge>
				);

				if (!item.tooltip) return avatarSpan;

				return (
					<Tooltip key={item.key}>
						<TooltipTrigger asChild>{avatarSpan}</TooltipTrigger>
						<TooltipContent>{item.tooltip}</TooltipContent>
					</Tooltip>
				);
			})}
			{totalOverflow > 0 && (
				<span className="ml-0.5 text-[11px] text-muted-foreground">+{totalOverflow}</span>
			)}
		</div>
	);
}
