import { CreateCommentThreadBodySchema } from "@stagereview/types/comments";
import { Command, Option } from "commander";
import { z } from "zod";
import { closeDb, getDb } from "../db/client.js";
import {
	addDiffScopeOptions,
	type DiffCommandOptions,
	toDiffScopeOptions,
} from "../diff-scope-options.js";
import { DIFF_SIDE } from "../schema.js";
import {
	CommentsCli,
	type CommentThreadWithStatus,
	resolveCommentScopeKey,
	THREAD_STATUS_FILTER,
	type ThreadStatusFilter,
} from "./comments-cli.js";

interface ListCommandOptions extends DiffCommandOptions {
	status: ThreadStatusFilter;
	json?: boolean;
}

interface CreateCommandOptions extends DiffCommandOptions {
	file: string;
	line: string;
	endLine?: string;
	side: string;
	body: string;
}

const positiveInt = z.coerce.number().int().positive();

/** Text for `--body`; whitespace-only input is as empty as no input. */
const commentBody = z
	.string()
	.refine((value) => value.trim().length > 0, "--body must not be empty.");

/** Commander hands us strings; coerce and validate them at the CLI boundary. */
const CreateCommandOptionsSchema = z.object({
	file: z.string().min(1),
	line: positiveInt,
	endLine: positiveInt.optional(),
	side: z.enum(DIFF_SIDE),
	body: commentBody,
});

const SHORT_ID_LENGTH = 8;
const PREVIEW_LENGTH = 72;

/**
 * `stagereview comments`: lets a coding agent read the comments a reviewer left
 * in the Stage UI and act on them (reply, resolve, reopen, or leave its own),
 * straight from the SQLite database — the review server need not be running.
 */
export function commentsCommand(): Command {
	const comments = new Command("comments").description(
		"Read and act on local review comments for a diff (no server required)",
	);

	addDiffScopeOptions(
		comments.command("list").description("List comment threads in the current diff scope"),
	)
		.addOption(
			new Option("--status <status>", "Which threads to list")
				.choices(Object.values(THREAD_STATUS_FILTER))
				.default(THREAD_STATUS_FILTER.OPEN),
		)
		.option("--json", "Print full thread objects as JSON")
		.action(async (refs: string[], opts: ListCommandOptions) => {
			const scopeKey = await resolveCommentScopeKey(toDiffScopeOptions(refs, opts));
			await withCli((cli) => {
				const threads = cli.list(scopeKey, opts.status);
				if (opts.json) {
					printJson(threads);
					return;
				}
				if (threads.length === 0) {
					const qualifier = opts.status === THREAD_STATUS_FILTER.ALL ? "" : `${opts.status} `;
					process.stdout.write(`No ${qualifier}comment threads in this diff scope.\n`);
					return;
				}
				process.stdout.write(`${threads.map(formatThreadLine).join("\n")}\n`);
			});
		});

	comments
		.command("show")
		.description("Print one thread, with every comment, as JSON")
		.argument("<threadId>", "Thread ID or an unambiguous prefix (6+ characters)")
		.action(async (threadId: string) => {
			await withCli((cli) => printJson(cli.show(threadId)));
		});

	comments
		.command("reply")
		.description("Add a reply to a thread")
		.argument("<threadId>", "Thread ID or an unambiguous prefix (6+ characters)")
		.requiredOption("--body <text>", "Reply text")
		.action(async (threadId: string, opts: { body: string }) => {
			await withCli((cli) => {
				const { thread } = cli.reply(threadId, requireBody(opts.body));
				process.stdout.write(`Replied to thread ${describeThread(thread)}.\n`);
			});
		});

	comments
		.command("resolve")
		.description("Resolve a thread, optionally posting a final reply first")
		.argument("<threadId>", "Thread ID or an unambiguous prefix (6+ characters)")
		.option("--body <text>", 'Closing reply, for example "Fixed: renamed the helper"')
		.action(async (threadId: string, opts: { body?: string }) => {
			await withCli((cli) => {
				const body = opts.body === undefined ? undefined : requireBody(opts.body);
				const thread = cli.resolve(threadId, body);
				process.stdout.write(`Resolved thread ${describeThread(thread)}.\n`);
			});
		});

	comments
		.command("reopen")
		.description("Reopen a resolved thread")
		.argument("<threadId>", "Thread ID or an unambiguous prefix (6+ characters)")
		.action(async (threadId: string) => {
			await withCli((cli) => {
				const thread = cli.reopen(threadId);
				process.stdout.write(`Reopened thread ${describeThread(thread)}.\n`);
			});
		});

	addDiffScopeOptions(
		comments
			.command("create")
			.description("Leave a new comment on a line range of the current diff"),
	)
		.requiredOption("--file <path>", "File path as it appears in the diff")
		.requiredOption("--line <n>", "First line of the range")
		.option("--end-line <n>", "Last line of the range (default: --line)")
		.addOption(
			new Option("--side <side>", "Which side of the diff the lines are on")
				.choices(Object.values(DIFF_SIDE))
				.default(DIFF_SIDE.ADDITIONS),
		)
		.requiredOption("--body <text>", "Comment text")
		.action(async (refs: string[], opts: CreateCommandOptions) => {
			const input = parseCreateInput(opts);
			const scopeKey = await resolveCommentScopeKey(toDiffScopeOptions(refs, opts));
			await withCli((cli) => {
				const thread = cli.create(scopeKey, input);
				process.stdout.write(`Created thread ${thread.id} (${formatAnchor(thread)}).\n`);
			});
		});

	return comments;
}

async function withCli(run: (cli: CommentsCli) => void | Promise<void>): Promise<void> {
	const db = getDb();
	try {
		await run(new CommentsCli(db));
	} finally {
		closeDb();
	}
}

function parseCreateInput(opts: CreateCommandOptions) {
	const parsed = CreateCommandOptionsSchema.safeParse(opts);
	if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
	const { file, line, endLine, side, body } = parsed.data;
	const input = CreateCommentThreadBodySchema.safeParse({
		filePath: file,
		side,
		startLine: line,
		endLine: endLine ?? line,
		body,
	});
	if (!input.success) throw new Error(z.prettifyError(input.error));
	return input.data;
}

function requireBody(body: string): string {
	const parsed = commentBody.safeParse(body);
	if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
	return parsed.data;
}

function printJson(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function describeThread(thread: CommentThreadWithStatus): string {
	return `${shortId(thread.id)} (${formatAnchor(thread)})`;
}

function shortId(id: string): string {
	return id.slice(0, SHORT_ID_LENGTH);
}

export function formatAnchor(thread: CommentThreadWithStatus): string {
	const range =
		thread.startLine === thread.endLine
			? `${thread.startLine}`
			: `${thread.startLine}-${thread.endLine}`;
	return `${thread.filePath}:${range}`;
}

/** One human-readable line per thread: short ID, status, anchor, and a preview of the root comment. */
export function formatThreadLine(thread: CommentThreadWithStatus): string {
	const root = thread.comments[0];
	const preview = root ? truncate(root.body.replace(/\s+/g, " ").trim(), PREVIEW_LENGTH) : "";
	return `${shortId(thread.id)}  ${thread.status.padEnd(8)}  ${formatAnchor(thread)}  ${preview}`;
}

function truncate(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
