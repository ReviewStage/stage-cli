import { useCallback, useEffect } from "react";

import {
	DEFAULT_TEXT_SIZE,
	resolveStoredTextSize,
	resolveTextSizeScale,
	type TextSize,
} from "./text-size";
import { parseStoredValue, useLocalStorage } from "./use-local-storage";

const STORAGE_KEY = "ui-text-size";

function applyTextSizeToDOM(size: TextSize): void {
	document.documentElement.style.fontSize = resolveTextSizeScale(size);
}

function readStoredTextSize(): TextSize {
	try {
		const stored = parseStoredValue<string>(
			window.localStorage.getItem(STORAGE_KEY),
			DEFAULT_TEXT_SIZE,
		);
		return resolveStoredTextSize(stored);
	} catch {
		return DEFAULT_TEXT_SIZE;
	}
}

// Apply the saved size before first paint. The hosted app does this with an inline
// pre-hydration script; the CLI SPA has no SSR, so a module-level init (which runs
// before React renders anything) fills the same role and prevents a flash of the
// default size.
applyTextSizeToDOM(readStoredTextSize());

interface TextSizeValue {
	textSize: TextSize;
	setTextSize: (size: TextSize) => void;
}

/**
 * App text size preference. Backed by the shared localStorage store, so every
 * consumer stays in sync without a provider; the effect re-syncs the document
 * root font-size whenever the resolved preference changes.
 */
export function useTextSize(): TextSizeValue {
	const [stored, setStored] = useLocalStorage<TextSize>(STORAGE_KEY, DEFAULT_TEXT_SIZE);
	const textSize = resolveStoredTextSize(stored);

	useEffect(() => {
		applyTextSizeToDOM(textSize);
	}, [textSize]);

	const setTextSize = useCallback((next: TextSize) => setStored(next), [setStored]);

	return { textSize, setTextSize };
}
