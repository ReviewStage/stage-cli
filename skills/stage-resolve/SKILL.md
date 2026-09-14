---
name: stage-resolve
description: Pick up the review comments the user left in the Stage UI for the current diff, make the requested changes, and resolve each thread.
user-invocable: true
---

# stage-resolve

Reads the local review comments the user left in the Stage browser UI (created by `/stage-chapters`), acts on each open thread, and resolves it. Uses `stagereview comments`, which reads and writes the same local database the UI uses — the `stagereview show` server does not need to be running, and the UI picks up your replies and resolutions automatically.

Every comment you write through the CLI is attributed to the agent and shows an "Agent" badge in the UI, so the user can tell your replies from their own notes.

## Prerequisites

Run this check before any other work. If it fails, stop with the error message — do not continue.

1. **`stagereview` is installed.** Run `which stagereview`. If it exits non-zero, instruct the user:

   ```
   stagereview is not installed. Run:

       npm install -g stagereview
   ```

## Arguments

- **Diff selectors.** Pass through any git refs or flags the user gave (`--pr 123`, `--base main`, `--ref staged`, `main..feature`, …) to every `list` and `create` call exactly as given. They select the same diff scope `/stage-chapters` used, so you see the threads the UI shows. With no arguments the CLI uses the same default scope `stagereview show` uses for the working tree.
- **A single thread ID** (full UUID or a prefix of at least 6 characters). When given, handle only that thread and skip the listing step.

## Step 1 — List open threads

Run this **before editing any files**, and keep the output — you will address threads by the IDs it returns:

```bash
stagereview comments list --status open --json [refs...] [--pr <ref>] [--base <ref>] [--compare <ref>] [--ref <mode>]
```

Each thread has `id`, `filePath`, `side` (`additions` = new file lines, `deletions` = old file lines), `startLine`, `endLine`, `status`, and `comments` ordered oldest first. Each comment carries `body`, `authorType` (`user` or `agent`), and timestamps.

If the list is empty, tell the user there are no open comment threads for this diff and stop.

> The diff scope is keyed on git state. If the working tree was clean when the review was opened and you then edit files, a later `list` with no arguments resolves to a different (working-tree) scope. Address threads by ID (`show`, `reply`, `resolve`, `reopen` are not scoped), and do not commit while working through threads unless the user asks.

## Step 2 — Handle each thread

For each open thread, in order:

1. **Read the whole conversation.** The first comment is the request; later comments may refine it or answer earlier questions.
2. **Skip threads waiting on the user.** If the last comment has `authorType: "agent"` and asks the user a question they have not answered, leave the thread alone and mention it in your summary.
3. **Decide what the comment asks for.**
   - A request or instruction ("rename this", "add a null check", "extract a helper") → make the change.
   - A question that implies an action ("should we add a test for this?", "could this be a constant?") → treat it as a request and make the change.
   - A pure question ("why does this fall back to the primary org?") → answer it and resolve the thread:
     ```bash
     stagereview comments resolve <threadId> --body "<answer>"
     ```
   - Genuinely unclear → do not guess and do not silently skip. Ask for clarification and leave the thread open:
     ```bash
     stagereview comments reply <threadId> --body "<specific question>"
     ```
4. **Before editing, read the surrounding source**, not just the anchored lines — the comment is anchored to a diff line range, but the right fix may live nearby. Follow the repository's coding guidelines (for example `AGENTS.md` or `CLAUDE.md`) and existing conventions.
5. **Make the change**, then run the project's relevant checks (typecheck, lint, tests) for the files you touched.
6. **Resolve with a short summary of what changed:**
   ```bash
   stagereview comments resolve <threadId> --body "Fixed: <what changed and where>"
   ```
   Keep the body to one or two sentences. Do not paste file contents.

To inspect a single thread in full at any point:

```bash
stagereview comments show <threadId>
```

## Step 3 — Report back

Run the listing again with the same selectors you used in Step 1:

```bash
stagereview comments list --status open [same selectors as Step 1]
```

Then tell the user:

- which threads you resolved and, in a line each, what you changed;
- which threads you replied to with a question and are waiting on them;
- that the Stage UI in their browser has already picked up your replies and resolutions.

## Leaving your own comments

If you notice something worth flagging while working — a risk, a follow-up, a question about intent — leave a comment on the diff rather than burying it in chat:

```bash
stagereview comments create --file <path> --line <n> [--end-line <n>] [--side additions|deletions] --body "<text>" [same selectors as Step 1]
```

Line numbers refer to the new file for `additions` (the default) and the old file for `deletions`.
