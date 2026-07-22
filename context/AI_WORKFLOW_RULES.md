# StarWindow — AI Workflow Rules

These rules exist to keep the codebase clean across multiple Claude Code sessions. AI models have a tendency to reinvent, duplicate, and over-engineer. These rules prevent that.

---

## Before Writing Any Code

Run through this checklist in order. Do not skip steps.

### 1. Read the context folder first
Before touching any file, read:
- `PROJECT_OVERVIEW.md` — understand what exists and what phase we're in
- `PROGRESS_TRACKER.md` — understand what's already built
- `CODING_STANDARDS.md` — understand patterns already in use

### 2. Scan existing code before creating anything new
- Check `client/src/utilities/` before writing a new client helper or API call (⚠️ also check `client/src/lib/` — it's a frozen duplicate API layer; reuse from it, never add to it)
- Check `server/db/queries/` before writing a new DB query
- Check `server/services/` before writing new business logic
- Check `server/utils/` and `server/middleware/cache.js` before writing helpers or TTL logic
- Check `client/src/components/` before building new UI; colors/radii come from `client/src/constants/tokens.ts`

### 3. Ask before introducing anything new
If the task would require:
- A new npm package
- A new architectural pattern not already used in the project
- A new file in a location that doesn't exist yet
- A new way of doing something that's already done elsewhere

**Stop and flag it** before proceeding. Don't just add it silently.

---

## The Core Anti-Patterns to Avoid

### ❌ Parallel implementations
Do not create a second version of something that already exists.

```
// If fetchVisibleBodies already exists in client/src/utilities/bodies-api.ts:
❌ Don't create a second fetch for /api/astronomy/bodies in another file
❌ Don't inline the same SQL in a route or service
✅ Import and use the existing function
```

This has already happened once — `client/src/lib/` vs `client/src/utilities/` are
parallel API layers (see PROGRESS_TRACKER). Don't repeat it.

### ❌ Defensive duplication
Do not copy-paste logic "just to be safe" or "to keep it isolated."
If logic needs to be shared, it belongs in a service or utility. Not duplicated.

### ❌ Speculative features
Do not add functionality that wasn't asked for.

```
// Task: "show a rocket launch details screen when clicking this button"
❌ Don't also add other pages for other event clicks
✅ Just add the rocket launch details screen
```

### ❌ Unused abstractions
Do not create base classes, factory functions, or plugin systems "for future flexibility" unless the task explicitly requires it.

### ❌ Inconsistent patterns
If the codebase already handles errors a certain way, uses a certain notification handler, or structures queries a certain way — match it. Do not introduce a new pattern because it's slightly better in isolation.

---

## When Adding to an Existing File

- Match the existing code style exactly — spacing, naming, import order
- Add to existing exports, don't create a parallel export file
- If a function needs to change, change it in place — don't create a v2 alongside it
- Update `PROGRESS_TRACKER.md` if the change completes or modifies a tracked item

---

## When Creating a New File

Only create a new file when:
- The feature is genuinely new with no existing home
- The existing file it would belong to would become unreasonably long
- The project structure explicitly calls for it (new service, new model, etc.)

When creating a new file:
- Place it in the correct directory per `CODING_STANDARDS.md`
- Follow the naming conventions exactly
- Add an entry to `PROGRESS_TRACKER.md`

---

## Session Handoff Protocol

At the end of every Claude Code session where code was written:

1. Update `PROGRESS_TRACKER.md` with what was completed
2. Note any decisions made that future sessions need to know
3. Note anything that was explicitly left out or deferred
4. If a new pattern was introduced (approved by the developer), document it in `CODING_STANDARDS.md`

This ensures the next session starts with accurate context and doesn't re-do or contradict completed work.

---

## How to Handle Ambiguity

If a task is unclear about where something should live or how it should work:

1. Look at how the most similar existing feature is built
2. Follow that pattern
3. If no similar feature exists, flag the ambiguity before writing code

Do not make assumptions silently. A wrong assumption applied across 200 lines of code is harder to fix than a clarifying question upfront.

---

## The One Rule

> **Write the minimum amount of code that correctly solves the task, using what already exists.**

Everything else follows from this.