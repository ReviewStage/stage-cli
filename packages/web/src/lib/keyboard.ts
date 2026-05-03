/**
 * True when a keyboard event came from a form input or contenteditable
 * element. Global key listeners use this to skip handling while the user is
 * typing, so single-key shortcuts (j/k, shift+f) don't fire mid-input.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	const tag = target.tagName;
	if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
	return target.isContentEditable;
}
