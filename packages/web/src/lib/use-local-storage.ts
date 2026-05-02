import { useCallback, useSyncExternalStore } from "react";

const localStorageListeners = new Set<() => void>();

function subscribeToLocalStorage(callback: () => void) {
	localStorageListeners.add(callback);
	window.addEventListener("storage", callback);
	return () => {
		localStorageListeners.delete(callback);
		window.removeEventListener("storage", callback);
	};
}

export function notifyLocalStorageListeners() {
	for (const listener of localStorageListeners) {
		listener();
	}
}

export function parseStoredValue<T>(raw: string | null, fallback: T): T {
	if (raw === null) return fallback;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (parsed === null || typeof parsed !== typeof fallback) return fallback;
		if (Array.isArray(parsed) !== Array.isArray(fallback)) return fallback;
		return parsed as T;
	} catch {
		return fallback;
	}
}

export function useLocalStorage<T>(
	key: string,
	initialValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
	const getSnapshot = useCallback(() => {
		try {
			return window.localStorage.getItem(key);
		} catch {
			return null;
		}
	}, [key]);

	const getServerSnapshot = useCallback(() => null, []);

	const raw = useSyncExternalStore(subscribeToLocalStorage, getSnapshot, getServerSnapshot);
	const stored = parseStoredValue(raw, initialValue);

	const setValue = useCallback(
		(value: T | ((prev: T) => T)) => {
			const current = (() => {
				try {
					const item = window.localStorage.getItem(key);
					return parseStoredValue(item, initialValue);
				} catch {
					return initialValue;
				}
			})();
			const next = typeof value === "function" ? (value as (prev: T) => T)(current) : value;
			try {
				window.localStorage.setItem(key, JSON.stringify(next));
			} catch {
				// Storage full or unavailable
			}
			notifyLocalStorageListeners();
		},
		[key, initialValue],
	);

	return [stored, setValue];
}
