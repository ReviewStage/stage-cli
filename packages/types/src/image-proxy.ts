/**
 * Shared image-proxy URL policy: which GitHub-hosted image URLs the local
 * /api/image-proxy will fetch with the user's token. The browser uses it to
 * decide which <img> sources to rewrite; the server uses it to validate the
 * requested url — one implementation so the two can never drift.
 */

const ALLOWED_HOSTS = new Set(["github.com", "private-user-images.githubusercontent.com"]);

const GITHUB_COM_ALLOWED_PATH_PREFIXES = ["/user-attachments/assets/"];

function isAllowedGitHubComPath(pathname: string): boolean {
	if (GITHUB_COM_ALLOWED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
		return true;
	}

	// /<owner>/<repo>/assets/<id> pattern
	const segments = pathname.split("/").filter(Boolean);
	return segments.length >= 4 && segments[2] === "assets";
}

export function isProxiableGitHubImageUrl(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}

	if (parsed.protocol !== "https:") return false;

	if (!ALLOWED_HOSTS.has(parsed.hostname)) return false;

	if (parsed.hostname === "github.com") {
		return isAllowedGitHubComPath(parsed.pathname);
	}

	return true;
}
