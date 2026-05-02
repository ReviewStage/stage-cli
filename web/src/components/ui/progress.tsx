import * as ProgressPrimitive from "@radix-ui/react-progress";
import type * as React from "react";

import { cn } from "@/lib/utils";

function Progress({
	className,
	value,
	...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
	return (
		<ProgressPrimitive.Root
			data-slot="progress"
			className={cn("relative h-2 w-full rounded-full bg-muted", className)}
			{...props}
		>
			<ProgressPrimitive.Indicator
				data-slot="progress-indicator"
				className="h-full rounded-full bg-green-600 transition-all duration-500 ease-out dark:bg-green-500"
				style={{ width: `${value || 0}%` }}
			/>
		</ProgressPrimitive.Root>
	);
}

export { Progress };
