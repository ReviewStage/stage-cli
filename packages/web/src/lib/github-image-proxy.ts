import { isProxiableGitHubImageUrl } from "@stagereview/types/image-proxy";

// GitHub-hosted comment images (user attachments) 404 when loaded cross-origin,
// because the browser's <img> request carries no GitHub credentials. Rewriting
// them through the CLI's local /api/image-proxy lets the server fetch them with
// the user's `gh` token. The URL policy is shared with the server via
// @stagereview/types/image-proxy so the two sides cannot drift.

const IMAGE_PROXY_PATH = "/api/image-proxy";

export function toProxiedImageUrl(originalUrl: string): string | null {
	// Signed private-user-images URLs already load directly (auth is baked into
	// the URL) and cannot be re-resolved by the local proxy once expired.
	const parsed = new URL(originalUrl);
	if (parsed.hostname === "private-user-images.githubusercontent.com") return null;

	const params = new URLSearchParams();
	params.set("url", originalUrl);
	return `${IMAGE_PROXY_PATH}?${params.toString()}`;
}

/** Rewrite a single image URL through the proxy; non-GitHub URLs pass through untouched. */
export function proxyGitHubImageUrl(url: string): string {
	if (!isProxiableGitHubImageUrl(url)) return url;
	return toProxiedImageUrl(url) ?? url;
}

/** Rewrite each candidate URL of a `srcset` attribute value through the proxy. */
export function proxyGitHubImageSrcset(rawSrcset: string): string {
	return rawSrcset
		.split(",")
		.map((rawCandidate) => {
			const candidate = rawCandidate.trim();
			if (!candidate) return candidate;

			const [candidateUrl, ...descriptors] = candidate.split(/\s+/);
			if (!candidateUrl) return candidate;

			const proxiedUrl = proxyGitHubImageUrl(candidateUrl);
			if (proxiedUrl === candidateUrl) return candidate;

			return [proxiedUrl, ...descriptors].join(" ");
		})
		.join(", ");
}

export { isProxiableGitHubImageUrl };
