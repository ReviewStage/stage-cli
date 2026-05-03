import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SidebarLayoutProps {
	children: ReactNode;
	sidebar: ReactNode;
	className?: string;
}

/**
 * Two-column layout used by the Files-changed tab. The sidebar sticks below
 * the tab nav (`--content-top`) so it stays in view while the diff list
 * scrolls. The main column gets `min-w-0` so its child diffs can overflow
 * cleanly without stretching the column.
 */
export function SidebarLayout({ children, sidebar, className }: SidebarLayoutProps) {
	return (
		<div className={cn("flex items-start gap-4", className)}>
			<div className="sticky top-[var(--content-top,4rem)] max-h-[calc(100vh-4rem)] shrink-0 self-start overflow-hidden">
				{sidebar}
			</div>
			<main className="min-w-0 flex-1 py-1">{children}</main>
		</div>
	);
}
