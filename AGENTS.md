# AGENTS.md

This file provides guidance to coding agents working in this repository, including Claude Code and Codex.

## Build & Development Commands

```bash
pnpm install            # Install dependencies (also installs husky pre-commit hook)
pnpm dev:web            # Start the web UI in Vite dev mode
pnpm build              # Build SPA, then bundle the CLI (writes packages/cli/{dist,web-dist})
pnpm test               # Run tests (Vitest, from root)
pnpm lint               # Biome check (lint + format) — fails on warnings
pnpm lint:fix           # Biome check with auto-fix
pnpm format             # Format code with Biome
pnpm typecheck          # tsc --noEmit across every package (`pnpm -r typecheck`)
```

The package manager is pinned via `packageManager` in `package.json`. Use `corepack enable` if pnpm isn't on your PATH.

### Database (Drizzle ORM + SQLite)

```bash
pnpm db:generate        # Generate a new migration into packages/cli/drizzle/ from schema changes
```

The CLI uses an embedded SQLite database via `better-sqlite3`. There is no separate dev database to start — `getDb()` opens (or creates) the local SQLite file and runs pending migrations on first use.

### Adding UI Components

```bash
cd packages/web && npx shadcn@latest add <component>
```

Components land under `packages/web/src/components/ui/` per `packages/web/components.json`.

## Architecture

**pnpm workspace.** Three packages with real boundaries — no path-alias indirection. The published unit is `packages/cli` (npm name `stagereview`, binary `stage-cli`); the rest are private workspace deps that get inlined at build time.

```
pnpm-workspace.yaml         # packages: ["packages/*"]
packages/
  cli/                      # stagereview — published npm package
    src/                    # CLI + local HTTP server (Node, ESM)
      index.ts              # CLI entry (Commander)
      show.ts               # `stage-cli show <path>` implementation
      server.ts             # Plain Node http server with regex-compiled routes
      routes/               # API route handlers (one file per resource)
      runs/                 # Chapter run import + processing
      db/                   # Drizzle client, path resolution, schema/
      schema.ts             # Zod schemas for chapter JSON ingestion (strict)
      __tests__/            # Vitest tests
    drizzle/                # Generated SQL migrations + meta journal
    drizzle.config.ts       # Drizzle Kit config
    tsdown.config.ts        # CLI bundler config (inlines @stage-cli/types)
  types/                    # @stage-cli/types (private, TS-native)
    src/chapters.ts         # Wire-format chapter/key-change schemas + shared HunkRef/LineRef
    src/view-state.ts       # Wire-format view-state schema
    src/index.ts            # Barrel re-export
  web/                      # @stage-cli/web (private) — built into ../cli/web-dist
    src/components/         # UI components (shadcn/ui under components/ui/)
    src/lib/                # Frontend utilities + tests
    src/routes/             # SPA route components
    src/styles/             # Tailwind globals
    vite.config.ts          # outDir → ../cli/web-dist
    components.json         # shadcn config
```

### CLI (`packages/cli/src/index.ts`)

Uses [Commander](https://github.com/tj/commander.js) for subcommand parsing. Add new subcommands by chaining `.command(...)` and delegating to a module under `packages/cli/src/`.

### Local Server (`packages/cli/src/server.ts`)

Plain Node `http` server bound to `127.0.0.1`. Route patterns use `:name` placeholders and are compiled to regexes at startup. The server resolves `/api/*` against registered routes and otherwise serves static files from `web-dist/` (next to the bundled CLI) with an `index.html` SPA fallback.

- Route handlers live in `packages/cli/src/routes/` — one file per resource (`runs.ts`, `view-state.ts`, `json.ts`).
- Path traversal is blocked by computing `path.relative(webDist, resolved)` and rejecting any result that escapes the root. **Don't bypass that check** when adding static-serving features.
- The server picks the first free port starting at `5391`. Don't hard-code ports in callers.

### Database Layer (`packages/cli/src/db/`)

- **Client:** `getDb()` in `db/client.ts` is a singleton wrapped around `better-sqlite3`. It enables WAL + foreign keys and auto-runs migrations from `packages/cli/drizzle/`.
- **Schemas:** `db/schema/*.ts`, re-exported from `db/schema/index.ts`. Pass `* as schema` into `drizzle()` so relational queries work.
- **Path:** `db/path.ts` decides where the SQLite file lives (per-OS app data dir).
- Prefer Drizzle's Relational Queries API over the SQL-like query builder unless you need aggregations, custom column selections, or complex joins.

### Shared Types (`packages/types/`)

Wire-format types shared between the CLI's HTTP routes and the SPA. The package exports `.ts` source directly (no compile step) — `tsdown` and `vite` resolve TypeScript natively. The CLI bundle inlines this package via `deps.alwaysBundle` in `tsdown.config.ts`, so the published tarball never has a runtime require for `@stage-cli/types`.

Building blocks like `HunkRef`, `LineRef`, and `DIFF_SIDE` live here; the strict ingestion schema (`ChaptersFileSchema`) stays in `packages/cli/src/schema.ts` and re-exports them.

### Web UI (`packages/web/`)

Vite app with React 19, Tailwind 4, and shadcn/ui (new-york style, zinc base, lucide icons). Builds into `../cli/web-dist`, which is bundled into the published npm package and served by the CLI's local HTTP server.

### Key Technologies

- **CLI:** Commander, Node 20+, ESM only
- **Server:** Node `http` (no Express/Fastify/oRPC)
- **Database:** Drizzle ORM, SQLite via `better-sqlite3`
- **Frontend:** Vite, React 19, Tailwind CSS 4, shadcn/ui
- **Validation:** Zod
- **Bundler:** tsdown (CLI), Vite (web)
- **Testing:** Vitest

## Code Style (Biome)

- Tabs for indentation (JS/TS), spaces for JSON
- Line width: 100 characters
- Double quotes, semicolons required, trailing commas everywhere
- `noUnusedImports: error` / `noUnusedVariables: error`
- `useImportType: error` / `useExportType: error` — use type imports/exports
- `noExplicitAny: error` and `noFocusedTests: error`
- `noConsole: warn` (allowing `console.error`/`console.warn`) — treat warnings as failures in PRs
- `organizeImports` runs on save/format

A `pre-commit` hook (husky + lint-staged) runs `biome check --write` against staged files. Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` locally before pushing.

## Package Naming

The published npm package is `stagereview` (lives in `packages/cli`); the CLI binary is `stage-cli`. Internal workspace packages use the `@stage-cli/*` scope (`@stage-cli/types`, `@stage-cli/web`) — they are private and never published.

## Testing

**See [TESTING.md](./TESTING.md) for the full testing strategy.** All testing decisions follow that document.

## Pull Request Format

- **Summary:** what changed and why
- **Changes:** bullet list of notable edits
- **Testing:** how the change was verified

## Git & Commit Workflow

- When executing a plan, commit incrementally — one logical unit of work per commit, not one giant commit at the end.
- Before every push, run `pnpm typecheck && pnpm lint && pnpm test` locally and ensure all checks pass. Never push with failing CI.

## Implementation Quality

- Follow Ousterhout's principles from A Philosophy of Software Design.
- Be "engineered enough": not fragile or hacky (under-engineered), and not abstracting prematurely or adding unnecessary complexity (over-engineered) - YAGNI.
- No hacky solutions. Implement things the way a senior engineer would — clean, robust, no code smells or anti-patterns.
- Follow modern best practices per official docs — not existing codebase patterns, which could contain antipatterns. Official documentation and canonical examples are authoritative; existing code is not.
- Prefer battle-tested libraries over custom implementations. Don't reinvent the wheel.
- DRY: flag and eliminate repetition aggressively.
- Embrace OOP for non-trivial logic: encapsulate state and behavior in classes with simple interfaces, not loose functions.
- Make code obvious and immediately understandable. Prefer explicit over clever.
- **Offensive programming, not defensive:** Only validate at system boundaries — CLI args, HTTP request bodies, JSON files on disk, external APIs. Inside the system, trust your own code and the type system. `?? fallback` is a lie — silent corruption is worse than a loud crash. Never add `??`, null-checks, or try/catch for states your code guarantees cannot occur.
- Err toward covering more edge cases, not fewer.
- No unnecessary comments.
- Follow React's "You Might Not Need an Effect" guidance before adding `useEffect`: https://react.dev/learn/you-might-not-need-an-effect
- Prefer Drizzle's Relational Queries API over the SQL-like query builder unless you need aggregations, custom column selections, or complex joins.
- No stringly-typed code. For fixed value sets: `as const` SCREAMING_SNAKE_CASE objects, unions via `typeof Foo[keyof typeof Foo]`, no parallel arrays; pass directly to Zod (`z.enum(FOO)`) or Drizzle. Raw strings only for freeform user-facing text. Never construct keys via concatenation or template literals (no `` `${runId}:${chapterId}` ``) — use nested objects or a `Map` with serialized/primitive keys instead.

## Component Design

- Consolidate sibling props that always travel together into a single type. Fewer props = simpler interfaces and less room for mismatches.

## Logging

- The CLI runs locally on a developer's machine, so logging is minimal. Errors that should reach the user are written to `process.stderr`; everything else stays silent.
- Log sparingly: only significant operation boundaries (`info`-equivalent), unexpected-but-recoverable situations (`warn`), and caught errors (`error`) — always include the underlying error message.
- Never log tokens, passwords, file contents, or anything that could include user code beyond what the user explicitly asked the CLI to display.

## TypeScript Safety Rules

- Do not use any unsafe type assertions: `as any`, `as unknown as T`, or non-null `!`.
- Do not use type assertions to narrow types. If you think you need one, STOP and:
  1. add/adjust types so inference works, OR
  2. validate at runtime using Zod and narrow from `unknown`, OR
  3. as a very last resort, use a type guard
- `noUncheckedIndexedAccess` is on — array/index access returns `T | undefined`. Handle the `undefined` case explicitly rather than asserting.

## Skill Routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill tool as your FIRST action. Do NOT answer directly, do NOT use other tools first. The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Iterate / babysit a PR → invoke iterate-pr
- Fix CI failures on a branch → invoke fixing-ci
- Resolve PR review comments → invoke fixing-pr-comments
- Rebase onto origin/main → invoke rebase-origin-main
- Quality review against this file's `## Implementation Quality` section → invoke quality-review
- Create a Linear issue from current context → invoke linear-issue
- Trade-off analysis → invoke trade-off
- De-slop UI / strip generic AI styling → invoke deslop-ui
