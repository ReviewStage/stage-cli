const MAX_PULL_REQUEST_BODY_CHARS = 4000;

export function truncatePrBody(body: string | null): string | null {
	if (!body) return null;
	return body.length > MAX_PULL_REQUEST_BODY_CHARS
		? `${body.slice(0, MAX_PULL_REQUEST_BODY_CHARS)}\n[truncated]`
		: body;
}
