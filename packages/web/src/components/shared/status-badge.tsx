import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

const BADGE_SIZE = {
	sm: "size-2.5",
	md: "size-3",
} as const;

type BadgeSize = keyof typeof BADGE_SIZE;

export function StatusBadge({
	children,
	badge,
	size = "sm",
	className,
	style,
}: {
	children: ReactNode;
	badge?: ReactNode;
	size?: BadgeSize;
	className?: string;
	style?: CSSProperties;
}) {
	return (
		<span className={cn("relative inline-flex shrink-0", className)} style={style}>
			{children}
			{badge && (
				<span
					className={cn(
						"-right-0.5 -bottom-0.5 absolute flex items-center justify-center rounded-full bg-background",
						BADGE_SIZE[size],
					)}
				>
					{badge}
				</span>
			)}
		</span>
	);
}
