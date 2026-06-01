import type * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
	return (
		<input
			type={type}
			data-slot="input"
			className={cn(
				"h-10 w-full min-w-0 rounded-lg border border-border/50 bg-background/50 px-3 py-1 text-sm outline-none transition-all duration-200 selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:bg-input/30",
				"hover:border-border focus-visible:border-primary/50 focus-visible:ring-[3px] focus-visible:ring-primary/20",
				"aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
