import { useState } from "react";

/** Keep a local edit once typing starts; otherwise follow the latest remote value. */
export function useRemoteDraft(remoteValue: string) {
	const [localValue, setLocalValue] = useState<string | null>(null);
	return {
		value: localValue ?? remoteValue,
		setValue: setLocalValue,
		reset: () => setLocalValue(null),
	};
}
