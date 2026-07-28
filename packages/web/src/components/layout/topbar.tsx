import { ThemeToggle } from "@/components/layout/theme-toggle";
import stageMarkUrl from "../../../../../assets/stage-mark.svg";

export function Topbar() {
	return (
		<header className="sticky top-0 z-30 flex h-12 shrink-0 items-center justify-between border-border border-b bg-background px-6 lg:px-8">
			<div className="flex min-w-0 items-center gap-2 text-sm">
				<img src={stageMarkUrl} alt="" className="size-[29px] shrink-0" />
				<span className="font-medium text-foreground">Stage</span>
			</div>
			<div className="flex shrink-0 items-center">
				<ThemeToggle />
			</div>
		</header>
	);
}
