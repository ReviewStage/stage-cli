import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SidebarLayoutProps {
	children: ReactNode;
	sidebar: ReactNode;
	className?: string;
}

/**
 * Two-column layout used by the Files-changed tab. Mirrors hosted-stage's
 * `SidebarLayout`: the sidebar pulls left to align with the page edge (counter
 * to the route's `px-6 lg:px-8`) and the main column gets `min-w-0` so its
 * children can overflow within the column instead of pushing it wider.
 *
 * The sidebar itself owns its sticky/scroll behavior via CollapsiblePicker.
 */
export function SidebarLayout({ children, sidebar, className }: SidebarLayoutProps) {
	return (
		<div className="flex flex-col">
			<div className="-mx-6 lg:-mx-8 sticky top-[var(--content-top)] z-10 border-border border-t" />
			<div className={cn("-ml-6 lg:-ml-8 flex items-start", className)}>
				<div className="flex shrink-0 items-start self-stretch">{sidebar}</div>
				<main className="min-w-0 flex-1 py-4 pl-4">{children}</main>
			</div>
		</div>
	);
}
