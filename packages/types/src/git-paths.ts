/**
 * Shared decoding for paths in git diff headers (`---`/`+++`, `rename from`/
 * `rename to`, `diff --git`). The CLI server and the web patch parser must
 * resolve identical paths for content lookups to work, so both consume this
 * one implementation. Uses TextEncoder/TextDecoder, available in Node and
 * browsers alike.
 */

const SHORTHAND_ESCAPES: Record<string, number> = {
	a: 0x07,
	b: 0x08,
	t: 0x09,
	n: 0x0a,
	v: 0x0b,
	f: 0x0c,
	r: 0x0d,
};

/**
 * Decode the C-style escapes git emits inside quoted paths: `\"` and `\\`,
 * control shorthands, and octal byte escapes for non-ASCII names (reassembled
 * as UTF-8 byte sequences). Iterates Unicode code points so literal non-BMP
 * characters are never split into lone surrogates; escape sequences are
 * ASCII-only, so inner indexing stays safe.
 */
export function decodeQuotedGitPath(raw: string): string {
	const bytes: number[] = [];
	const encoder = new TextEncoder();
	const chars = Array.from(raw);
	for (let i = 0; i < chars.length; i++) {
		const ch = chars[i];
		if (ch !== "\\") {
			for (const byte of encoder.encode(ch ?? "")) bytes.push(byte);
			continue;
		}
		const next = chars[i + 1];
		if (next === undefined) break;
		const octal = chars.slice(i + 1, i + 4).join("");
		if (/^[0-7]{3}$/.test(octal)) {
			bytes.push(Number.parseInt(octal, 8));
			i += 3;
			continue;
		}
		const code = SHORTHAND_ESCAPES[next];
		if (code !== undefined) {
			bytes.push(code);
		} else {
			for (const byte of encoder.encode(next)) bytes.push(byte);
		}
		i += 1;
	}
	return new TextDecoder().decode(new Uint8Array(bytes));
}

/**
 * Decode a raw header capture: strip git's trailing TAB (emitted after paths
 * containing spaces or specials), unwrap surrounding quotes with their
 * escapes, map `/dev/null` to null, and drop the diff prefix (`a/`/`b/`,
 * which sits inside the quotes) when one applies.
 */
export function decodeGitHeaderPath(
	raw: string | undefined,
	prefix: "a/" | "b/" | null,
): string | null {
	if (raw === undefined || raw === "") return null;
	// git appends a TAB after ---/+++ paths containing spaces or specials.
	let decoded = raw.replace(/\t$/, "");
	if (decoded.startsWith('"') && decoded.endsWith('"') && decoded.length >= 2) {
		decoded = decodeQuotedGitPath(decoded.slice(1, -1));
	}
	if (decoded === "/dev/null") return null;
	if (prefix !== null && decoded.startsWith(prefix)) decoded = decoded.slice(prefix.length);
	return decoded;
}

/**
 * Resolve the ambiguity in unquoted `diff --git a/P b/P` headers when P itself
 * contains " b/": for non-renames both paths are identical, so try the split
 * where the two halves match before any greedy fallback.
 */
export function splitEqualGitHeader(firstLine: string): [string, string] | null {
	if (!firstLine.startsWith("diff --git a/")) return null;
	const rest = firstLine.slice("diff --git a/".length);
	// P + " b/" + P → total length 2*|P|+3
	if ((rest.length - 3) % 2 !== 0) return null;
	const half = (rest.length - 3) / 2;
	const candidate = rest.slice(0, half);
	if (rest.slice(half, half + 3) === " b/" && rest.slice(half + 3) === candidate) {
		return [candidate, candidate];
	}
	return null;
}
