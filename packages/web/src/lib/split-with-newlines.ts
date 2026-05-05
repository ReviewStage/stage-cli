/**
 * Splits file content into lines while preserving each line's trailing "\n".
 *
 * Pierre expects each entry in deletionLines/additionLines to include its
 * trailing newline. A plain split("\n") strips them, causing Shiki decoration
 * positions to exceed the actual rendered line count.
 */
export function splitWithNewlines(content: string | null | undefined): string[] | undefined {
	if (content == null) return undefined;
	return content.match(/[^\n]*\n|[^\n]+/g) ?? undefined;
}
