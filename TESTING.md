# Testing Strategy

This is stage-cli's canonical testing policy. All testing decisions — by humans and AI agents — follow this document.

## Philosophy

- **Confidence over coverage.** Optimize for confidence in shipping, not coverage numbers.
- **Cheapest test that catches the bug.** Prefer the lowest-cost test layer that would detect the defect.
- **TypeScript + Biome are the first test layer.** Strict TypeScript catches wrong arg types, missing fields, and null access (`noUncheckedIndexedAccess` is on). Biome catches unused code and import issues. Don't duplicate either with tests.
- **"Write tests. Not too many. Mostly integration."** End-to-end tests that exercise the CLI's HTTP routes against a real SQLite database are the highest-ROI automated tests in this codebase.

## Test Layers (Priority Order)

### 1. Static Analysis

TypeScript strict mode (`strict: true`, `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`) + Biome. Free. Run `pnpm typecheck` and `pnpm lint` before pushing.

### 2. Route / Server Integration Tests

Test API route handlers through the real `startServer()` HTTP boundary, hitting a real SQLite database created in a temp directory. Mock only what isn't part of the CLI itself (none today — the CLI has no external services).

**This is the highest-ROI test layer.** Most logic worth testing is request handling, schema validation, and database state transitions.

Examples:
- `src/__tests__/runs.routes.test.ts` — exercises run/chapter routes against a real server + SQLite
- `src/__tests__/view-state.routes.test.ts` — exercises view-state routes end-to-end
- `src/__tests__/server.test.ts` — covers the static-file fallback, route compilation, and path-traversal guard

Use the helpers in `src/__tests__/fixtures.ts` to spin up a temp DB and the server.

### 3. Pure Logic Unit Tests

Schemas, parsers, and pure helpers. No mocks needed — these are pure functions.

Examples:
- `src/__tests__/schema.test.ts` — Zod chapter-import schemas
- `src/__tests__/path.test.ts` — DB path resolution
- `src/__tests__/import-chapters.test.ts` — chapter import transformation

### 4. Web UI Component Tests

Narrow exception: tests for keyboard navigation, focus management, and form behavior in the React UI that can't be exercised via the server.

**Constraints:**
- Must mock zero or one external boundary (the CLI's `/api/*` fetch calls)
- Must mock at most one internal module
- If a test needs more, lift the logic out of the component into `web/src/lib/` and test it there

There are no web UI tests today. If you add the first one, set up a JSDOM Vitest project under `web/` rather than mixing it into the Node test config.

## What to Test

- Business logic with branching, data transformation, or edge cases
- Path-resolution / sandboxing logic (the static-file path-traversal guard is security-sensitive)
- Parsing and normalization (chapter JSON ingestion, schema validation)
- API route handlers through their HTTP boundary
- Bug fixes (regression test required)
- Non-obvious Zod schema defaults or transforms

## What NOT to Test

- **Static rendering** — components that only render fixed markup with no conditional logic or user interaction
- **Type-guaranteed behavior** — outcomes the type system already enforces
- **Trivial schema validation** — a Zod schema parsing a valid object is a tautology
- **Component rendering in JSDOM that requires mocking 2+ internal modules** — if you need router + fetch + global store, the test is testing the mock, not the app
- **UI library component behavior** — that a tooltip, popover, or dialog renders correctly is the library's job
- **Drizzle / better-sqlite3 itself** — assume the libraries work; only test your queries and migrations

## The Mock Budget Rule

A test may mock at most:
- **One external-service boundary** — for now, none (the CLI is fully local). For future work, this would be one HTTP API or one process boundary.
- **One internal module** — `vi.mock()` for fetch, a route handler, or a hook

If a test needs 2+ internal mocks, the test is testing the mock setup, not the app. Either:
1. Extract the logic into a pure module and test it directly
2. Lift the test up to the route/server layer and use a real DB
3. Don't write the test

**Infrastructure fakes don't count** toward the budget:
- Test clocks (`vi.useFakeTimers()`)
- Environment variable overrides
- Temp directories / temp DBs
- Simple stubs for browser APIs (`matchMedia`, `ResizeObserver`, `IntersectionObserver`)

**Escape hatch:** If a test file exceeds 200 lines due to legitimate test complexity (not mock setup), split by behavior group into multiple files. The mock budget still applies per file.

## AI Agent Testing Rules

1. **Never modify production source code to make a test writable.** If the code is hard to test, either test at a different level or skip the test.
2. **Max 200 lines per test file.** If a module has 15+ behaviors worth testing, split into multiple focused test files by behavior group.
3. **Never mock more than one external-service boundary** per test file.
4. **Never mock more than one internal module** per test file.
5. **Never test that a component "renders without crashing"** — TypeScript already guarantees this.
6. **Factory functions over inline object literals.** Use `make*` or `create*` helpers in `src/__tests__/fixtures.ts` (or alongside the test file) with overrides.
7. **One clear behavior per test.** Name by behavior, not method name.
8. **Arrange-Act-Assert.** One clear action per test.
9. **Use a real DB, not a mock.** Spin up a temp SQLite via the existing fixtures. Drizzle/better-sqlite3 are fast enough that mocking them is never the right call.

## When TDD Is Required

- Bug fixes (write the failing test first, then fix)
- Path-resolution / static-file sandbox changes
- Parsers and data transformers
- Schema changes that affect ingestion or query shape

## When TDD Is Optional

- Exploratory UI work
- Layout and styling
- Straightforward CRUD wiring (still test once it works)
- Prototyping (but add tests before merging)

## PR Requirements

- New business logic, bug fixes, and security-sensitive changes (anything touching path resolution or static serving) **must** include tests
- Visual-only UI changes **do not** require tests
- New API routes **must** have at least one route-level integration test before merging

## Slop Cleanup Rule

**Never disable or delete tests to make them pass — fix the underlying issue.** The only exception is slop tests (defined below), which should be deleted or rewritten when you're already modifying the code they cover.

When modifying code that is covered by a slop test (a test that violates the mock budget), delete or rewrite the test as part of the change. Don't leave broken-window tests in place.

**Definition of a slop test:** A test that mocks 2+ internal modules, OR has more mock setup lines than assertion lines, OR tests only that a component renders static markup, OR mocks the database instead of using a real temp SQLite.

## Decision Guide

| Scenario | Test layer | TDD? |
|---|---|---|
| Bug fix | Regression test at cheapest layer | Required |
| New API route | Route/server integration with real DB | Required |
| New business rule / logic | Pure unit or route integration | Required |
| Path-resolution / static-file change | Route/server integration | Required |
| Visual-only UI change | None | N/A |
| New parser / transformer | Pure unit | Required |
| New React component (logic-heavy) | Extract logic to `web/src/lib/`, test there | Optional |
| New React component (display-only) | None | N/A |
| New schema migration | Route integration that exercises new columns | Required |
