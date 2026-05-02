import { useSyncExternalStore } from "react";

declare global {
	interface Navigator {
		userAgentData?: { platform: string };
	}
}

function subscribe() {
	return () => {};
}

function getSnapshot() {
	if (navigator.userAgentData) {
		return navigator.userAgentData.platform === "macOS";
	}
	return navigator.platform.toUpperCase().startsWith("MAC");
}

function getServerSnapshot() {
	return false;
}

export function useIsMac() {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
