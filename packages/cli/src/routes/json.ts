import type { IncomingMessage, ServerResponse } from "node:http";

export function writeJson(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
}

const MAX_JSON_BODY_BYTES = 1024 * 1024;

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
	let total = 0;
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		total += buf.length;
		if (total > MAX_JSON_BODY_BYTES) {
			throw new Error(`Request body exceeds ${MAX_JSON_BODY_BYTES} bytes`);
		}
		chunks.push(buf);
	}
	const text = Buffer.concat(chunks).toString("utf8");
	if (text.length === 0) return {};
	return JSON.parse(text);
}
