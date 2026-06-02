import type { ReactNode } from "react";

/**
 * Sticky header row shared by the overview sidebar (Prologue/Description tabs)
 * and the chapters column, so both columns' headers align and pin while their
 * content scrolls independently.
 */
export function OverviewColumnHeader({ children }: { children: ReactNode }) {
	return (
		<div className="sticky top-0 z-10 bg-background pb-3">
			<div className="flex h-7 items-center justify-between">{children}</div>
		</div>
	);
}
