import { ThemeToggle } from "@/components/layout/theme-toggle";
import { StageMark } from "@/components/shared/stage-mark";

export function Topbar() {
	return (
		<header className="sticky top-0 z-30 flex h-12 shrink-0 items-center justify-between border-border border-b bg-background px-6 lg:px-8">
			<div className="flex min-w-0 items-center gap-2.5 text-sm">
				<StageMark className="shrink-0" size={18} />
				<span className="font-medium text-foreground">Stage</span>
			</div>
			<div className="flex shrink-0 items-center">
				<ThemeToggle />
			</div>
		</header>
	);
}
