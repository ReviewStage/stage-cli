---
name: stage-chapters
description: Generate Stage chapters for the current local git branch and open them in a browser for review.
user-invocable: true
---

# stage-chapters

Generates a Stage chapter run for the current local git branch and opens it in a browser. The skill detects the base ref, computes the diff, generates chapters from it, writes a JSON file matching the `stage-cli` schema, and hands the file to `stage-cli show` to launch the SPA.

## Prerequisites

Run these checks before any other work. If either fails, stop with the error message — do not continue.

1. **`stage-cli` is installed.** Run `which stage-cli`. If it exits non-zero, instruct the user:

   ```
   stage-cli is not installed. Run:

       npm install -g stagereview

   Then retry /stage-chapters.
   ```

   Stop.

2. **The current directory is a git repo.** Run `git rev-parse --is-inside-work-tree`. If it does not print `true`, stop with:

   ```
   /stage-chapters must be run inside a git repository.
   ```

## Step 1 — Detect base ref

Find the branch the user reviews against. Try each of the following in order; the first that succeeds becomes `<base>`:

1. `git rev-parse --abbrev-ref origin/HEAD 2>/dev/null` — typically prints `origin/main`. Use the full output (e.g. `origin/main`) as `<base>`; do **not** strip `origin/`, because the bare name (`main`) may not exist locally in single-branch clones.
2. `git rev-parse --verify main 2>/dev/null` — local `main` branch; use `main` as `<base>`.
3. `git rev-parse --verify master 2>/dev/null` — older repos; use `master` as `<base>`.
4. `git rev-parse --verify origin/main 2>/dev/null` — remote-tracking fallback when `origin/HEAD` is unset; use `origin/main` as `<base>`.
5. `git rev-parse --verify origin/master 2>/dev/null` — remote-tracking fallback for older repos; use `origin/master` as `<base>`.

If all five fail, stop with:

```
No default branch detected. Tried origin/HEAD, main, master, origin/main, and origin/master.
```

`<base>` is whatever ref expression was verified above and is passed verbatim to `git merge-base` / `git rev-parse` in Step 2.

## Step 2 — Get the diff

Compute the merge-base and dump the unified diff for the committed range only:

```bash
MERGE_BASE=$(git merge-base <base> HEAD)
HEAD_SHA=$(git rev-parse HEAD)

git diff "$MERGE_BASE..HEAD"
```

If `git merge-base` exits non-zero or `MERGE_BASE` is empty, stop with an error like `Could not compute merge-base between <base> and HEAD (unrelated histories or shallow clone).` Do **not** continue — running `git diff "..HEAD"` with an empty `MERGE_BASE` produces an empty diff that would silently yield zero chapters.

`git diff <merge-base>..HEAD` covers exactly the commits on the branch since it diverged from the base — the same range the SPA renders for a `committed` run (`baseSha..headSha` in `packages/cli/src/routes/diff.ts`). Save the full diff text into context for Step 3.

This skill scopes review to *committed* work. If the user has uncommitted changes to tracked files, instruct them to commit first; mixing committed and working-tree changes into a single run would produce `hunkRefs`/`lineRefs` that don't line up with the diff the SPA serves.

`MERGE_BASE` and `HEAD_SHA` are full 40-character SHAs that feed directly into the JSON `scope` field in Step 4.

## Step 3 — Cluster + narrate

Using the full diff from Step 2, produce a `chapters` array. Each chapter groups related hunks into a coherent story beat, narrates them for a reviewer unfamiliar with this part of the codebase, and flags judgment calls that need human input.

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

Every hunk in the diff **must** appear in exactly one chapter. No hunk may be omitted and no hunk may appear in more than one chapter.

Identify each hunk by its exact `(filePath, oldStart)` tuple from the unified-diff `@@ -X,Y +A,B @@` header. Use the EXACT `oldStart` value from the `@@` header — do not recount lines yourself.

- `filePath` is the path after `b/` in the `diff --git a/... b/...` line.
- `oldStart` is the `X` in `@@ -X,Y +A,B @@`. For newly created files the header is `@@ -0,0 +1,N @@`, so `oldStart` is `0`.

After building the chapters array, verify:
1. The total number of `hunkRefs` across all chapters equals the total number of `@@` headers in the diff.
2. Every `(filePath, oldStart)` pair from the diff appears in exactly one chapter's `hunkRefs`.

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

- Use OLD-column line numbers for `side: "deletions"` (left side of the diff).
- Use NEW-column line numbers for `side: "additions"` (right side of the diff).
- Keep ranges tight — point to the specific lines the question is about, not the entire hunk.
- `startLine` and `endLine` must both be positive integers with `endLine >= startLine`.

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

- Do **not** invent `hunkRefs` — only use `(filePath, oldStart)` tuples that actually appear in the diff's `@@` headers.
- `keyChanges[].lineRefs` must have at least one entry per key change.

## Step 4 — Write JSON file

Compute a unique temp path. The trailing `XXXXXX` (with no suffix after) is required by macOS BSD `mktemp` — placing characters after the X's causes BSD `mktemp` to return the template verbatim instead of substituting random characters:

```bash
TMPFILE=$(mktemp "${TMPDIR:-/tmp}/stage-chapters.XXXXXX")
```

`stage-cli show` reads JSON regardless of file extension, so the missing `.json` suffix is fine.

The `${TMPDIR:-/tmp}` fallback matters on macOS, where `os.tmpdir()` resolves to `/var/folders/...` but `$TMPDIR` is not always set in every shell. Avoid `date +%s%N` — the `%N` (nanoseconds) format is a GNU extension and on macOS BSD `date` it emits a literal `N`, breaking uniqueness.

Write a JSON file at `"$TMPFILE"` matching the shape below. The file must validate against `ChaptersFileSchema` in `packages/cli/src/schema.ts`; mismatched fields will be rejected by `stage-cli show`.

High-level shape:

```
{ scope: {...}, chapters: [...], generatedAt: "..." }
```

Full example:

```jsonc
{
  "scope": {
    "kind": "committed",
    // Set baseSha = mergeBaseSha = $MERGE_BASE so the SPA renders
    // baseSha..headSha — the same range chapters were generated from.
    "baseSha": "<MERGE_BASE>",
    "headSha": "<HEAD_SHA>",
    "mergeBaseSha": "<MERGE_BASE>"
  },
  "chapters": [
    {
      "id": "ch-1",
      "order": 1,
      "title": "Short imperative title",
      "summary": "Why this chapter matters to the reviewer.",
      "hunkRefs": [
        { "filePath": "path/to/file.ts", "oldStart": 42 }
      ],
      "keyChanges": [
        {
          "content": "A judgment-call question for the reviewer (not source code).",
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
  ],
  "generatedAt": "2026-05-04T12:34:56.000Z"
}
```

Field rules:

| Field | Constraint |
|-------|------------|
| `scope.kind` | `"committed"` or `"workingTree"` |
| `scope.ref` | Required when `kind` is `"workingTree"`; one of `"work"`, `"staged"`, `"unstaged"` |
| `scope.baseSha` / `headSha` / `mergeBaseSha` | Full 40-character lowercase hex SHAs |
| `chapters[].id` | Non-empty, unique within the run |
| `chapters[].order` | Positive integer (1-indexed) |
| `chapters[].hunkRefs[].oldStart` | Non-negative integer — the pre-image start line from the unified-diff `@@` header (`0` for new files) |
| `chapters[].keyChanges[].lineRefs` | Array with at least one entry |
| `lineRefs[].side` | `"additions"` (right side) or `"deletions"` (left side) |
| `lineRefs[].startLine` / `endLine` | Positive integers; `endLine >= startLine` |
| `generatedAt` | ISO 8601 datetime string |

## Step 5 — Display generated chapters

Hand the file to `stage-cli`:

```bash
stage-cli show "$TMPFILE"
```

`stage-cli show` validates the JSON, inserts a new `chapter_run` plus chapters and key changes into the local SQLite database, boots a loopback HTTP server, and opens the browser to the new run. The command stays running and serves the SPA until the user kills it with Ctrl+C — invoke it as the final command in the workflow rather than expecting it to print a value and exit.

Do not pass a `runId` and do not call a separate `stage-cli ingest`. `show <path>` does ingestion and serving in one step.
