import { createContext, type ReactNode, use, useEffect, useMemo, useState } from "react";
import type { CollapseState } from "@/components/files";

interface CollapseActionsContextValue {
	collapseState: CollapseState | null;
	setCollapseState: (state: CollapseState | null) => void;
}

const CollapseActionsContext = createContext<CollapseActionsContextValue | null>(null);

export function CollapseActionsProvider({ children }: { children: ReactNode }) {
	const [collapseState, setCollapseState] = useState<CollapseState | null>(null);

	const value = useMemo(() => ({ collapseState, setCollapseState }), [collapseState]);

	return <CollapseActionsContext value={value}>{children}</CollapseActionsContext>;
}

export function useCollapseActionsFromNav(): CollapseState | null {
	const ctx = use(CollapseActionsContext);
	return ctx?.collapseState ?? null;
}

export function useProvideCollapseActions(collapseState: CollapseState): void {
	const ctx = use(CollapseActionsContext);
	const setter = ctx?.setCollapseState;

	useEffect(() => {
		setter?.(collapseState);
		return () => setter?.(null);
	}, [setter, collapseState]);
}
