---
name: trade-off
description: Use at any stage — planning, before implementing, or reviewing code that's already written — to surface high-level trade-offs that could significantly simplify the work. Scans two layers in strict priority order. First, user-facing behavior (features, flows, states, settings, notifications, undo, real-time, bulk ops) — cutting a behavior removes the architecture and code behind it. Second, architectural design (queues, caches, background jobs, new packages, new tables, new services, streaming, real-time infra) — cutting an architectural piece removes whole categories of implementation. Stops there; code-level simplification is outside scope. Proactively invoke whenever the scope of a task looks like it could grow, whenever you catch yourself about to add a queue, cache, new package, new table, new service, or behavior that wasn't explicitly requested, or when looking back at a recent diff that feels larger than the task warranted.
metadata:
  internal: true
---

# Trade-off

Agents over-build by default. They add product behaviors, flows, and UI states that weren't asked for, and they reach for queues, caches, new packages, new tables, and real-time infra when nothing in the task demanded them. The cost is paid forever: more surface area for users to get confused by, more infra to operate, and more code to read, maintain, and change later.

This skill is a forcing function. At any point in the lifecycle of a task — planning, before implementation, or looking back at a diff — identify what could be **cut** by accepting a reasonable trade-off, and surface those cuts to the user as explicit decisions.

## When to use

Invoke this any time complexity is visible. There are three natural moments:

1. **Planning** — sketching what the feature should do. Trade-offs are cheapest here because nothing is built yet; the cut is just "don't design it in."
2. **Before implementing** — a plan exists, you're about to write code. Last chance to cut before the work starts.
3. **After implementing** — reviewing a diff you or another agent just produced. The cut now means deleting code, which is more expensive than not writing it, but still usually worth it.

Signals any of the three applies:

- The task spans multiple UI states, screens, or flows
- There's notification, history, undo, real-time, or bulk behavior on the surface area
- A new behavior is being added that isn't the core ask but felt "natural to include"
- The plan introduces a queue, worker, cache layer, or background job
- The plan adds a new package in the monorepo, a new database table, or a new external service
- The plan uses streaming, websockets, SSE, or other real-time infra
- A migration or backfill is being designed
- A new admin surface or auth surface is being added
- The user's request is short but the scope feels long
- The diff touches multiple files across packages when the ask named one

If the task is genuinely small and concrete and the plan/diff reflects that, skip this skill.

## Two layers: behavior first, then architecture

Simplification happens at two levels, and the order matters: **always scan user-facing behavior first, then architecture**. A behavior-level cut deletes the feature *and* the architecture *and* the code behind it. An architecture-level cut removes whole categories of implementation without touching what the user sees. If you jump past either and go straight to code, you silently lock in scope and infra decisions the user never got to make.

Code-level simplification (validation, retries, abstractions, loop shapes) is out of scope for this skill — those cuts are narrow and land through normal code review. This skill is for the decisions above that.

### Layer 1: User-facing behavior (scan first)

What the user sees and can do. These are the biggest wins. Ask: does this behavior need to exist *at all*, or in *this shape*?

- A whole feature, page, or flow that isn't load-bearing for the core job
- A step in a wizard or form that could be merged into another or removed
- A setting or preference the user rarely changes (hardcode the sensible default)
- A permission tier, role, or visibility level that duplicates another with minor variation
- Undo / redo (accept the action is permanent, or reversed manually)
- Real-time updates (require a refresh)
- Notifications, emails, or alerts (the user sees it next time they visit)
- Bulk operations (one-at-a-time is tedious but shippable)
- Mobile support (desktop-only until demand is proven)
- A bespoke empty state with illustration and copy (show the same UI with zero items + one button)
- Multi-language / localization
- Keyboard shortcuts, drag-and-drop, animation polish, and similar affordances on top of the baseline interaction
- Admin UIs for things that can be set via a script or the database for now
- Progress indicators, history/audit logs, activity feeds on actions the user already knows they did
- Confirmation modals on reversible actions

### Layer 2: Architectural design (scan second, only after behavior)

The shape of the system around the remaining behavior. Ask: does this piece of infra or structure need to exist, or can the behavior be served by something already in place?

- A background job / queue / worker (run it inline on the request if it's fast enough)
- A cache layer (skip it if the underlying query is fast and traffic is low)
- A new package in the monorepo (fold it into an existing one; extract later if it earns its own boundary)
- A new database table (add columns to an existing one, or use a JSON column, if the shape is simple)
- A new external service or integration (use one you already have, or do without)
- Real-time infra — websockets, SSE (poll on an interval, or require a refresh)
- A streaming response (return the final payload once if latency is acceptable)
- A separate admin app or surface (add a gated route to the existing app)
- An event bus / pub-sub (call the downstream functions directly when there are only one or two)
- A cron / scheduled job (trigger on the next relevant user action)
- A migration or backfill (change the code and let new data use the new shape; leave old data as-is)
- A new auth surface (reuse the existing session / token setup)

Most tasks have 1–3 real opportunities, usually weighted toward Layer 1. List only those — don't pad.

## What a trade-off looks like

A trade-off is a **specific thing to cut** paired with **what the user accepts in exchange**. Vague ("keep it simple") doesn't count. The format is:

> **Cut X.** In exchange, Y. This is fine because Z.

Behavior-layer examples (the highest-leverage kind — scan these first):

- **Cut the "draft" state for reviews.** Users either publish immediately or abandon. Fine because every user interview skips the draft step, and drafts add a state machine, a separate list view, and cleanup logic.
- **Cut the email notification on review completion.** The user sees it next time they open the app. Fine because we don't have email infra wired up and the in-app indicator already exists.
- **Cut the bespoke empty state for "no chapters yet".** Show the same list UI with zero rows plus a single "Generate your first chapter" button. Fine because this state is brief (first-run only) and custom illustration work isn't where the value is.
- **Cut the admin UI for toggling org features.** Flip flags via a DB query or a small script for now. Fine because there are 3 orgs and none of them self-serve this.
- **Cut bulk delete.** Users delete one at a time. Fine because deletion is rare and selection UI + batched mutation + partial-failure handling is a chunk of work for something that may never get used.
- **Cut the confirmation modal on archive.** Archived items are restorable from the archive tab. Fine because the action is already reversible and modals interrupt flow.

Architecture-layer examples (scan after behavior has been settled):

- **Cut the background job for chapter generation.** Run it inline on the request. Fine because generation is <30s and we're well under Vercel Function's 300s timeout; revisit when we hit real scale.
- **Cut the Redis cache on the repo list endpoint.** Hit Postgres directly on every request. Fine because the query is <50ms and we're at hundreds of requests/day; a cache here is speculative infra.
- **Cut the new `@stage/notifications` package.** Put the one function in `@stage/api` for now. Fine because there's one caller and extracting a package before there's a second caller is premature.
- **Cut the new `review_drafts` table.** Store the two fields as a JSON column on the existing `reviews` row. Fine because we never query into them, and a full table brings migrations, joins, and a schema boundary for no payoff.
- **Cut websockets for live review status.** Poll every 10s from the client. Fine because status changes are user-triggered and infrequent; websockets add connection management and infra we don't need yet.
- **Cut the separate admin app.** Add a `/admin` route to the existing web app gated by role. Fine because there are 3 admins and building a parallel auth surface is premature.
- **Cut the event bus.** Call the two downstream functions directly. Fine because there are only two and a bus before the third caller exists is speculative indirection.

Each names a concrete thing being removed, what the user experiences instead, and why that's acceptable **in this specific context**. "Fine because" is the load-bearing part — it's what lets the user judge whether you're right.

## How to surface them

Stop and ask before acting. Don't bundle trade-offs into a plan and barrel ahead, and don't silently leave them out after reviewing code. The user's judgment is the whole point — you want them to push back on cuts that matter and confirm ones that don't.

Adapt the framing to the stage:

**Planning or pre-implementation:**
```
Before I start, here are trade-offs I'd propose to keep this small:

1. Cut [specific thing]. In exchange, [what user accepts]. Fine because [reason].
2. Cut [specific thing]. In exchange, [what user accepts]. Fine because [reason].

Tell me which to drop from the cut list and I'll build those in.
```

**Post-implementation review:**
```
Looking at what's here, a few things I'd propose cutting to simplify:

1. Cut [specific thing, with file reference if applicable]. In exchange, [what user
   accepts]. Fine because [reason].
2. …

Want me to remove any of these?
```

Three rules for the surfacing:

1. **Be specific.** Not "I'll keep it minimal" — name the behavior, state, feature, or code path being removed. If post-implementation, cite the file.
2. **Lead with the cut, not the preservation.** The default is to build (or keep) everything; the news is what's *not* there.
3. **Don't editorialize.** No "I recommend..." — let the trade-offs stand on their merits. The user knows their product.

## What not to cut

Some things aren't trade-offs, they're correctness. Don't propose cutting:

- Security boundaries (auth checks, authorization, injection safety)
- Data integrity (transactions where needed, unique constraints, referential integrity)
- Loud failure at system boundaries (error messages users see, logs for ops)
- Things the user explicitly asked for in the original request

If you catch yourself proposing to cut one of these, reframe: it's not a trade-off, it's a bug.

## Why this works

The goal isn't minimalism as an aesthetic. It's preserving the user's decision-making authority over complexity. Silent over-implementation denies them that authority — they can't push back on behavior or code they never saw being considered. Making trade-offs visible turns "complexity creep" from a drift into a deliberate choice, either way.

It also front-loads disagreement. Better to hear "no, we actually do need offline support" at minute zero than after the simpler version ships, or to hear "yeah, rip that out" at review time than after the code has accreted dependencies for a month.
