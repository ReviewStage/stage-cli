import type { IncomingMessage, ServerResponse } from "node:http";
import type { z } from "zod";

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

/**
 * Reads and validates a JSON request body at the route boundary. Returns the parsed
 * value, or null after writing a 400 — malformed/oversized JSON or a schema mismatch.
 * Callers should `return` immediately when the result is null.
 */
export async function parseJsonBody<T>(
	req: IncomingMessage,
	res: ServerResponse,
	schema: z.ZodType<T>,
): Promise<T | null> {
	let raw: unknown;
	try {
		raw = await readJsonBody(req);
	} catch (err) {
		writeJson(res, 400, { error: err instanceof Error ? err.message : "Invalid JSON body" });
		return null;
	}
	const parsed = schema.safeParse(raw);
	if (!parsed.success) {
		writeJson(res, 400, { error: parsed.error.issues[0]?.message ?? "Invalid request body" });
		return null;
	}
	return parsed.data;
}
