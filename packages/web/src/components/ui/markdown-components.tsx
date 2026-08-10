import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

export const pre = ({ className, ...props }: ComponentPropsWithoutRef<"pre">) => (
	<pre
		className={cn(
			"my-2 overflow-x-auto rounded-md border border-border/50 bg-zinc-900 p-3 text-xs text-zinc-100 dark:bg-zinc-950",
			className,
		)}
		{...props}
	/>
);
