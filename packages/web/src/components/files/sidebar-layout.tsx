import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SidebarLayoutProps {
	children: ReactNode;
	sidebar: ReactNode;
	className?: string;
}

// Anchor the content column to the same viewport-filling height as the sticky
// sidebar (see ChapterSidePanel). Without a height floor the column collapses to
// its natural content height, so collapsing files in an already-scrolled list
// leaves the page scrolled into empty space below the now-short column.
const CONTENT_COLUMN_MIN_HEIGHT = "min-h-[calc(var(--main-height)_-_var(--content-top))]";

/**
 * The sidebar pulls left to align with the page edge (counter to the route's
 * `px-6 lg:px-8`); the main column needs `min-w-0` so its children can
 * overflow within the column instead of pushing it wider.
 */
export function SidebarLayout({ children, sidebar, className }: SidebarLayoutProps) {
	return (
		<div className="flex flex-col">
			<div className="-mx-6 lg:-mx-8 sticky top-[var(--content-top)] z-10 border-border border-t" />
			<div className={cn("-ml-6 lg:-ml-8 flex items-start", className)}>
				<div className="flex shrink-0 items-start self-stretch">{sidebar}</div>
				<main className={cn("min-w-0 flex-1 py-4 pl-4", CONTENT_COLUMN_MIN_HEIGHT)}>
					{children}
				</main>
			</div>
		</div>
	);
}
