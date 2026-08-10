/**
 * Replace literal `\n` sequences with actual newlines, but preserve them inside
 * inline backtick code spans (`` `...\n...` ``) where the author may be referring
 * to the escape character itself.
 *
 * Fenced code blocks (` ``` `) DO get unescaped because the newlines are
 * structural — markdown parsers need actual newlines to recognise block boundaries
 * and diagram renderers (mermaid) need them for correct parsing.
 */
export function unescapeLiteralNewlines(s: string): string {
	// Match fenced code blocks (```…```), inline code spans (``…`` or `…`), or literal \n.
	// Fenced blocks and prose get \n→newline; inline spans are left untouched.
	return s.replace(/```[\s\S]*?```|``[\s\S]*?``|`[^`]*`|\\n/g, (match) => {
		if (match.startsWith("```")) return match.replaceAll("\\n", "\n");
		if (match.startsWith("`")) return match;
		return "\n";
	});
}
