import { createContext, type ReactNode, use, useEffect, useMemo, useState } from "react";
import type { CollapseState } from "@/components/files";

interface CollapseActionsWithCount {
	collapseState: CollapseState;
	fileCount: number;
}

interface CollapseActionsContextValue {
	actions: CollapseActionsWithCount | null;
	setActions: (actions: CollapseActionsWithCount | null) => void;
}

const CollapseActionsContext = createContext<CollapseActionsContextValue | null>(null);

export function CollapseActionsProvider({ children }: { children: ReactNode }) {
	const [actions, setActions] = useState<CollapseActionsWithCount | null>(null);

	const value = useMemo(() => ({ actions, setActions }), [actions]);

	return <CollapseActionsContext value={value}>{children}</CollapseActionsContext>;
}

export function useCollapseActionsFromNav(): CollapseActionsWithCount | null {
	const ctx = use(CollapseActionsContext);
	return ctx?.actions ?? null;
}

export function useProvideCollapseActions(collapseState: CollapseState, fileCount: number): void {
	const ctx = use(CollapseActionsContext);
	const setter = ctx?.setActions;

	useEffect(() => {
		setter?.({ collapseState, fileCount });
		return () => setter?.(null);
	}, [setter, collapseState, fileCount]);
}
