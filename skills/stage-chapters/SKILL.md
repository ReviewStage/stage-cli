---
name: stage-chapters
description: Generate Stage chapters for the current local git branch and open them in a browser for review.
user-invocable: true
---

# stage-chapters

Generates a Stage chapter run for the current local git branch and opens it in a browser. Uses `stagereview prep` to compute the diff, then generates chapters and a prologue, and hands the result to `stagereview show` to launch the SPA.

## Prerequisites

Run these checks before any other work. If either fails, stop with the error message — do not continue.

1. **`stagereview` is installed.** Run `which stagereview`. If it exits non-zero, instruct the user:

   ```
   stagereview is not installed. Run:

       npm install -g stagereview

   Then retry /stage-chapters.
   ```

   Stop.

2. **The current directory is a git repo.** Run `git rev-parse --is-inside-work-tree`. If it does not print `true`, stop with:

   ```
   /stage-chapters must be run inside a git repository.
   ```

## Step 1 — Run prep

```bash
PREP_FILE=$(stagereview prep)
```

`stagereview prep` auto-detects the base ref (main/master), computes the merge-base, generates the diff, filters out lockfiles/binaries, and formats hunks with line numbers for analysis. By default it auto-detects the diff scope: if uncommitted changes are present the diff includes staged, unstaged, and untracked files; otherwise it uses the committed branch diff. It writes a plain-text file and prints only the file path to stdout.

Both `prep` and `show` accept these optional flags:

- **`--base <ref>`** — base ref to diff against (default: auto-detect main/master).
- **`--ref <mode>`** — diff scope. One of:
  - `work` — staged + unstaged + untracked changes (full working tree vs merge-base).
  - `staged` — only staged changes (index vs HEAD).
  - `unstaged` — only unstaged changes (working tree vs index).
  - Omitted — auto-detect (equivalent to `work` when uncommitted changes exist, committed branch diff otherwise).

When either flag is specified, pass it to **both** `prep` and `show`:

```bash
PREP_FILE=$(stagereview prep --base feature-a --ref staged)
# ... later ...
stagereview show --base feature-a --ref staged "$AGENT_OUTPUT"
```

If `prep` exits non-zero, relay its stderr to the user and stop.

**Do not modify files in the working tree between running `prep` and running `show`.** Both commands independently snapshot the git state. If the diff changes between them, `show` will reject the chapters with a hunk coverage error because the hunks no longer match.

## Step 2 — Read prep output

Read `$PREP_FILE` via the Read tool (or equivalent). For large diffs, use the Read tool's `offset` and `limit` parameters to read in chunks.

The file has two sections separated by headers:

1. **`=== COMMIT MESSAGES ===`** — `git log --oneline` output for prologue context.
2. **`=== HUNKS ===`** — formatted diff hunks with line numbers. Each hunk looks like:

```
=== File: src/app.ts (modified) | filePath: "src/app.ts", oldStart: 1 ===
=== Hunk @1: @@ -1,5 +1,6 @@ ===
1 1 | const a = 1;
2   |-const b = 2;
  2 |+const b = 3;
  3 |+const c = 4;
3 4 | const d = 5;
```

The two number columns are the **old line number** (left) and **new line number** (right). A blank column means the line doesn't exist on that side — additions have no old line number, deletions have no new line number. These numbers are used directly for `lineRefs` in key changes (see Step 3d).

`commits.txt` contains `git log --oneline` output for prologue context.

## Step 3 — Cluster + narrate

Using the hunks from `hunks.txt`, produce a `chapters` array. Each chapter groups related hunks into a coherent story beat, narrates them for a reviewer unfamiliar with this part of the codebase, and flags judgment calls that need human input.

### 3a — Clustering rules

Group hunks by **causal relationship** — changes that set up or enable later changes belong together.

- Spanning multiple files is expected and correct (e.g., schema + API + UI for one feature = one chapter).
- Moves and refactors are a single chapter — when code is removed from one file and added to another (or a file is deleted and a similar one created), group the deletion and addition hunks together as one "Move/Refactor" chapter, not separate "Remove" and "Add" chapters.
- Split only when changes are truly independent — a reviewer could understand one without knowing about the other.
- Tests belong with their implementation chapter.
- Config/dependency changes can be their own chapter if unrelated to a feature chapter.

**Chapter ordering:**

1. Foundation first: types, interfaces, schemas, utilities that others depend on
2. Core logic next: main implementation
3. Integration last: wiring, configuration, tests

Consider symbol dependencies between chapters — a chapter that introduces a type another chapter uses must come first.

**Hunk ordering within a chapter:**

- Group all hunks from the same file together — do not interleave hunks from different files.
- Within the same file, list hunks in ascending `oldStart` order (matching file layout).

### 3b — Self-validation rules

Every hunk in the formatted diff **must** appear in exactly one chapter. No hunk may be omitted and no hunk may appear in more than one chapter.

Each hunk header in the prep output has the format:
```
=== File: <path> (<status>) | filePath: "<path>", oldStart: <N> ===
```

Use the `filePath` and `oldStart` values from these headers to build `hunkRefs`.

`stagereview show` validates hunk coverage automatically — it will error with a list of missing or extra hunks if the chapters don't account for every hunk in the diff. If this happens, fix the chapters and retry.

### 3c — Narration rules

Write each chapter as a story beat — a meaningful step that moves the branch forward, not a summary of files changed.

- **Title:** action-oriented verb phrase, max 8 words (e.g., "Wire org ID through the API layer"). No filler like "Add support for".
- **Summary:** 2–3 sentences covering what this chapter enables and why. Lead with impact, then connect to the broader purpose. When a chapter builds on a previous one, open with that causal link explicitly (e.g., "Now that X is in place…").
  - Keep paragraphs short. Prefer splitting distinct points into separate short paragraphs (separated by a blank line) rather than writing one long dense paragraph. Each paragraph should convey a single idea.
  - Markdown allowed: `**bold**` for emphasis, `*italics*` for nuance, `` `backticks` `` for inline code references, and fenced code blocks when a short snippet (≤ 6 lines) helps illustrate the change.

### 3d — Key change rules

Key changes are **judgment calls only a human reviewer can make** — things that require product context, team conventions, or knowledge of the author's intent. Linters, type checkers, and code-review bots already cover correctness and style; skip anything they can catch. Ignore auto-generated files.

Return an **empty array** when nothing needs human input — do **not** invent items to fill the list. When a chapter is a straightforward rename, type fix, or mechanical refactor with no judgment calls, `keyChanges` should be `[]`.

Frame each item as a **question**.

Each key change includes `lineRefs`: one line range per distinct spot the question depends on. Most questions touch a single location, so use one range; only add more when the judgment genuinely spans related code in different places.

**Reading line numbers from `hunks.txt`:** Each diff line shows two number columns — old (left) and new (right). Use these numbers directly:
- For `side: "deletions"` — use the **old** (left) column number as `startLine`/`endLine`.
- For `side: "additions"` — use the **new** (right) column number as `startLine`/`endLine`.
- Do **not** count lines yourself — read the numbers from the formatted output.

Keep ranges tight — point to the specific lines the question is about, not the entire hunk. `startLine` and `endLine` must both be positive integers with `endLine >= startLine`.

**Good examples:**

- "Should `retryCount` reset when the user switches orgs?"
- "Is a 60-minute session timeout appropriate for this user base, or would 30 minutes be safer?"
- "Does this new index cover the query patterns the team actually uses in production?"

**Bad examples:**

- "Check that the auth logic is correct." — vague, verifiable by reading the code
- "The function now handles errors." — changelog item, not a question
- "Make sure the tests pass." — CI catches this, not a human judgment call

### 3e — Output format

Produce an array of chapter objects. Each chapter:

```jsonc
{
  "id": "chapter-1",    // unique within the run, e.g. "chapter-1", "chapter-2", …
  "order": 1,           // positive integer, 1-indexed
  "title": "Short imperative title",
  "summary": "Why this chapter matters to the reviewer.",
  "hunkRefs": [
    // one entry per hunk in the chapter
    { "filePath": "path/to/file.ts", "oldStart": 42 }
  ],
  "keyChanges": [
    // zero or more judgment-call questions
    {
      "content": "A judgment-call question for the reviewer.",
      "lineRefs": [
        {
          "filePath": "path/to/file.ts",
          "side": "additions",
          "startLine": 50,
          "endLine": 55
        }
      ]
    }
  ]
}
```

- Do **not** invent `hunkRefs` — only use `(filePath, oldStart)` tuples that actually appear in the formatted hunks.
- `keyChanges[].lineRefs` must have at least one entry per key change.

## Step 4 — Generate prologue

After building the chapters, generate a **prologue** — a high-level overview of the entire change. The prologue helps reviewers orient themselves before diving into individual chapters.

Use `commits.txt` from the prep output for context.

Using the diff, chapters, and commit messages, produce a `prologue` object with the following fields:

### motivation (string or null)

One sentence a non-engineer would understand. What was broken, annoying, or missing — from a person's perspective. If the commit messages are generic and the diff doesn't make the motivation obvious, use `null`.

**Good:** "Dashboards would break during deploys, so people had to keep refreshing until things came back."
**Bad:** "The API client had no retry logic for 503 errors." (too technical — no one outside the team knows what that means)

### outcome (string or null)

One sentence a non-engineer would understand. What's better now. Same null rule as motivation.

**Good:** "Dashboards stay up during deploys now."
**Bad:** "Added exponential backoff with a base delay of 100ms." (implementation detail)

### keyChanges (array of 2–5 objects)

Each object has:
- `summary`: 6–10 words describing what's different now. **Outcome-focused**, not action-focused.
- `description`: Capitalized sentence, 10–15 words of additional context.

**Good:** `summary: "Audit runs are now tracked in a database"`, `description: "Uses new Drizzle ORM schema with full history retention"`
**Bad:** `summary: "Adds Drizzle ORM layer"` (action-focused — describe what changed, not what you did)

### focusAreas (array of 1–5 objects)

Always provide at least 1 focus area. Even clean changes have spots worth a reviewer's attention.

Each object has:
- `type`: one of `security`, `breaking-change`, `high-complexity`, `data-integrity`, `new-pattern`, `architecture`, `performance`, `testing-gap`
- `severity`: one of `critical`, `high`, `medium` (for problems) or `info` (for points of interest)
- `title`: 3–5 word noun phrase (e.g., "Unvalidated user input")
- `description`: WHY this was flagged + a declarative action for the reviewer. Use "confirm", "verify", or "check" to give the reviewer a specific task.
- `locations`: array of file paths where this applies

**Good:** `type: "security", severity: "high", title: "Unvalidated user input", description: "User-provided ID passed directly to database query — confirm input is validated and parameterized"`
**Bad:** `description: "Worth understanding"` (no action, vague)

### complexity

Object with:
- `level`: one of `low`, `medium`, `high`, `very-high`
- `reasoning`: brief explanation (e.g., "New DB schema plus multiple service changes")

### Style

Talk like a coworker, not a changelog. No jargon, no filler phrases, no "this change introduces/implements/adds". Just say what happened and why it matters.

## Step 5 — Write agent output

Compute a unique temp path and write the JSON via a bash heredoc:

```bash
AGENT_OUTPUT=$(mktemp "${TMPDIR:-/tmp}/stage-agent-output.XXXXXX")
cat > "$AGENT_OUTPUT" << 'AGENT_EOF'
{
  "chapters": [ ... ],
  "prologue": { ... }
}
AGENT_EOF
```

The trailing `XXXXXX` (with no suffix after) is required by macOS BSD `mktemp`. Using `cat` with a heredoc avoids tool-specific file-writing issues.

Field rules:

| Field | Constraint |
|-------|------------|
| `chapters[].id` | Non-empty, unique within the run |
| `chapters[].order` | Positive integer (1-indexed) |
| `chapters[].hunkRefs[].oldStart` | Non-negative integer — the pre-image start line from the `oldStart` in the formatted hunk header (`0` for new files) |
| `chapters[].keyChanges[].lineRefs` | Array with at least one entry |
| `lineRefs[].side` | `"additions"` (right side) or `"deletions"` (left side) |
| `lineRefs[].startLine` / `endLine` | Positive integers; `endLine >= startLine` |
| `prologue` | Optional object; omit entirely if not desired |
| `prologue.motivation` | String or `null` |
| `prologue.outcome` | String or `null` |
| `prologue.keyChanges` | Array of 2–5 objects with `summary` and `description` |
| `prologue.focusAreas` | Array of 1–5 objects |
| `prologue.focusAreas[].type` | One of: `security`, `breaking-change`, `high-complexity`, `data-integrity`, `new-pattern`, `architecture`, `performance`, `testing-gap` |
| `prologue.focusAreas[].severity` | One of: `critical`, `high`, `medium`, `info` |
| `prologue.complexity.level` | One of: `low`, `medium`, `high`, `very-high` |

## Step 6 — Display generated chapters

Hand the file to `stagereview`:

```bash
stagereview show "$AGENT_OUTPUT"
```

`stagereview show` auto-detects the agent output format, independently computes the scope and "Other changes" chapter for filtered files, validates the JSON, inserts the run into the local SQLite database, boots a loopback HTTP server, and opens the browser.

**The command blocks until the user presses Ctrl+C.** If your harness requires non-blocking execution, run it in the background (e.g., `run_in_background` in Claude Code). Invoke it as the final command in the workflow.
