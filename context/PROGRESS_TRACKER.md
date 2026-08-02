# StarWindow — Progress Tracker

> Update this file at the end of every Claude Code session where code was written.
> This is the source of truth for what's in progress and what's next.

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Complete |
| 🔄 | In progress |
| ⏳ | Planned, not started |
| ❌ | Blocked or deferred |
| 📝 | Needs decision before starting |

---

## Current Workstream: Polish the UI

The app is feature-complete as a first pass (dashboard, events, calendar, map, profile, auth). Nothing else is scheduled until the UI polish pass is done. Steps below are ordered — earlier items unblock later ones.

### 1. One styling system ✅ (decided 2026-07-18)
**Decision: stay on `StyleSheet.create` + `constants/tokens.ts`. NativeWind is deferred** (STYLING.md kept for the eventual migration). `tokens.ts` is now the single token source: `Palette`, `Radius`, `Spacing`, `Breakpoints`, `Fonts`, `BottomTabInset`, and an `alpha()` helper for translucent overlays. `constants/theme.ts` is deleted.

### 2. Consistent colors — single token source ✅ (2026-07-18)
- ✅ Deleted template `Colors`/`theme.ts`; `themed-text`/`themed-view` now render the Palette dark theme directly (`use-theme` + `use-color-scheme` hooks removed); map screen no longer renders in template black/white
- ✅ Deduplicated `Palette` to one name per value (semantic names won: `bgVoid/bgDeep/surface/surfaceRaised`, `border/borderSoft`, `textPrimary/Secondary/Muted/Tertiary`, `accent/accentMuted/accentGlow`, status accents); `Radius.xl` (dup of `lg`) removed
- ✅ Replaced every hex literal outside `tokens.ts` with tokens — month-grid was recolored from an off-brand blue palette (`#3A86FF`/`#A7C4FF`/`rgb(11,18,38)`) onto the StarWindow cyan theme; new semantic tokens added where genuinely distinct (`accentAmber`, `moonLit`, `moonShadow`, `shadow`, `splashBackground`)
- ✅ rgba() literals in dashboard/event-modal converted to `alpha(Palette.x, opacity)`
- ✅ `global.css` trimmed to font vars only (color block was an out-of-sync duplicate nothing consumed)

### 3. Consistent sizing/spacing 🔄
- ✅ One spacing scale in `tokens.ts` (`Spacing.xxs…xxxl`); dashboard's local `spacing` object deleted; template `Spacing` (half/one/two/…) consumers (calendar, month-grid, map-screen) ported
- ⏳ Normalize card/border-radius/typography sizes across dashboard, events, calendar, profile (they were built in separate sessions and drift)

### 4. Responsive design ⏳
- ✅ Shared `Breakpoints` constant added to `tokens.ts` (tablet 768 / desktop 1024) — not yet consumed
- ✅ Events filter bar wraps instead of clipping (2026-08-01) — `app/events.tsx` rendered its type pills in a horizontal `ScrollView`, so with ~14 filters the row ran off the right edge of the page. Swapped to a `View` with `flexDirection: 'row'` + `flexWrap: 'wrap'`, matching the pattern `pages/calendar.tsx` already used for the identical pill bar. Verified at 1280px (2 rows) and 375px (7 rows), all pills reachable
- ⏳ Only `pages/calendar.tsx` adapts to width (`useWindowDimensions`); dashboard, events, profile, map assume desktop
- 📝 **`dvw()` as a max-width is wrong at mobile widths** (found 2026-08-01 while screenshotting events at 375px). `dvw(n)` emits a *viewport-relative* unit, so `maxWidth: dvw(800)` = `55.5dvw` — it caps the events list at ~208px on a 375px screen, squeezing cards until titles/locations truncate. It reads like an 800px cap but isn't. Same pattern to audit anywhere `dvw()` is used for a `maxWidth`/`width` cap; folds into the `responsive-dimensions` portability item below
- ⏳ `AppSidebar` is always visible when logged in — needs a collapse/drawer behavior at narrow widths
- ⏳ `login`/`signup` read `Dimensions.get('window')` at call time without subscribing to changes — switch to `useWindowDimensions`
- ⏳ Audit fixed pixel widths in dashboard preview cards and event cards at mobile sizes

### 5. Structural cleanup that blocks polish 🔄
- ✅ Deleted dead template code: commented-out `app/explore.tsx`, `app-tabs(.web)`, `external-link`, `web-badge`, `hint-row`, `ui/collapsible`, `use-theme`, `use-color-scheme(.web)`, `constants/theme.ts`
- ✅ Fixed the two nav targets that pointed at the broken `/explore` route: sidebar "Launches" item removed (Events covers launches), dashboard launch card and star-map popup now route to `/events` (typed routes caught these)
- ⏳ Split `pages/dashboard-screen.tsx` (~2,470 lines) into components (moon hero, preview cards, star field) — restyling it as a monolith will churn
- ⏳ Move the events screen from `app/events.tsx` into `pages/` with a thin route file, matching every other screen
- ⏳ Merge the duplicate client API layers (`src/lib/` → `src/utilities/`); delete dead `fetchMoonView` in `lib/astronomy.ts` (calls `/api/astronomy/moon`, which doesn't exist on the server)
- ⏳ Delete unused Expo template assets (`react-logo*`, `expo-badge*`, `tutorial-web.png`), `scripts/reset-project.js`, empty `constants/css.d.ts`

### 6. Visual QA pass ⏳
- ⏳ Web at 375px / 768px / 1280px widths for every screen (colors changed subtly on month-grid selection, gauge tiers, error text — eyeball them)
- ⏳ At least one native target (Expo Go) per STYLING.md rule
- ⏳ Loading/empty/error states styled consistently (spinner + message pattern varies per screen today)

**Session log 2026-07-18:** steps 1–2 done, 3/5 partially, verified with `tsc --noEmit` (clean) and `expo export --platform web` (builds, `/explore` gone from route map). Deliberate small visual shifts from de-duplication: divider `#1b314f`→`border`, dividerText `#5c7c9d`→`textMuted`, month-grid recolor, gauge tier colors → status accents, error text `#ff9a9a`→`accentRed`.

**Session log 2026-07-18 (merge):** Upstream (AntonProLysenko/StarWindow) PRs #22–23 merged into `feature/audit`. Local `main` fast-forwarded to `upstream/main` (it had no unique commits — the "ahead 51" was only the stale `origin` fork). Conflict policy: teammate's `dvw()`/`dvh()` responsive sizing + new features (leveling system, saved event notes, synthetic event-detail route from the dashboard launch card) kept; our canonical token names + dead-template deletions kept; token renames applied to incoming code. Verified: tsc clean, web export builds, dashboard renders with no console errors. **New flags:** (1) `responsive-dimensions.ts` emits CSS `dvw`/`dvh` strings — web-only, breaks on native; unify with the `Breakpoints` plan in step 4. (2) Upstream deleted `client/docs/STYLING.md`, `CSS-TO-TAILWIND.md`, and `server/docs/schema-guide.md` — doc references updated. (3) `origin` fork is stale; push `main` and `feature/audit` to origin when ready.

---

## Flagged During Codebase Audit (2026-07-18) — not scheduled, needs owner decision 📝

Recorded here so future sessions don't rediscover them. **No fixes have been written.** Details in the audit summary; highest-priority first:

1. ✅ **IDOR on `/api/user-events`** — verified 2026-07-24: already fixed. Every route in `routes/api/userEvents.js` has `ensureLoggedIn` and derives `req.user.user_id` from the JWT for reads, saves, deletes, and patches; the request body is no longer trusted. The stale `NOTE` comment at the top of that file (about trusting body `user_id`) no longer reflects the code.
2. ✅ **Signup accepts arbitrary `status_id`** — fixed 2026-07-24. `User.create` no longer reads `status_id` from the request body; it resolves the base tier server-side via `getBaseStatusId()` (lowest `min_points`, mirroring `leveling.js`). Client no longer sends `status_id` (removed from the signup call and the `SignUpData` type).
3. ✅ **bcrypt `SALT_ROUNDS`** — fixed 2026-07-25. Raised 6 → 12 in `models/user.js`. Added transparent rehash-on-login (`verifyPassword` re-hashes at the current cost after a successful `bcrypt.compare` when the stored hash is weaker) so existing cost-6 users are upgraded on their next login — necessary because there's no change-password flow. Login controller now calls `User.verifyPassword`; unused `bcryptjs` import dropped from the controller.
4. ✅ **JWT `?token=` query param** — fixed 2026-07-25. `config/checkToken.js` now reads the token from the `Authorization` header only. Verified nothing in the client relied on the query param (client sends `Bearer` header via `send-request.ts`).
5. ✅ **DB SSL** — fixed 2026-07-25. `config/database.js` now verifies the server cert (`rejectUnauthorized: true`) when a CA is supplied via `DB_SSL_CA` / `DB_SSL_CA_PATH` (download from Supabase → Project Settings → Database → SSL). Without a CA it stays encrypted-but-unverified and **logs a warning** (Supabase's direct-connection chain is self-signed, so strict verification without their CA fails with `SELF_SIGNED_CERT_IN_CHAIN` — verified). To fully close this, add the CA cert to the server `.env`.
6. ✅ **Login user enumeration** — fixed 2026-07-25. Login returns one message ("Invalid email or password") for both unknown-email and wrong-password, and `User.verifyPassword` runs a bcrypt compare against a dummy hash when the user is null, so response timing doesn't leak whether an email is registered either. `controllers/api/users.js`, `models/user.js`.
7. ✅ **Rate limiting / abuse protection** — added 2026-07-25 via `express-rate-limit` (in-memory), configured in `server/middleware/rateLimit.js`: `apiLimiter` (120/min baseline on all `/api`), `externalApiLimiter` (40/min on the paid-quota routes — astronomy, weather, score, map, news), and `authLimiter` (10 failed attempts / 15 min on `POST /api/users` + `/login`, `skipSuccessfulRequests` so real users aren't locked out). 429s return `{ error, status: 429 }` + standard `RateLimit-*` headers. Set `TRUST_PROXY` in env when deployed behind a proxy/CDN so limits key on the real client IP. Note: in-memory store is per-instance — a multi-instance deploy needs a shared store (Redis).
8. ✅ **Error responses leak internals** — fixed 2026-07-25. Added `sendError()` in `controllers/api/users.js`: logs the full error server-side, returns the message only for intentional 4xx errors (thrown with `error.status`), and a generic message for everything else. Never returns `err.code`. Model validation/conflict errors now carry `error.status` (400/409); the signup unique-email violation (Postgres 23505) is mapped to a friendly 409.
9. ✅ **PII/debug logging** — fixed 2026-07-25. Removed the email logs on signup/login and the `console.log(req.user)` in the `checkToken` controller.
10. 📝 **Auth doesn't persist on native** — `users-service.ts` falls back to in-memory token storage when `localStorage` is missing (needs AsyncStorage/SecureStore before native ships).
11. ✅ Housekeeping — fixed 2026-07-25. `nodemon` moved to `devDependencies`; unused `body-parser` (removed from deps) and `ensureLoggedIn` imports dropped from `server.js`; dead `express.static("build")` removed; duplicate `POST /signup` route removed (client uses `POST /api/users`). Also recorded `pngjs` in deps.

---

## Completed

**Events list performance — 8s → 0.4s (2026-08-01):**
- ✅ `GET /api/events/list` took ~8s on every load. The cache was working (no external API calls), but `attachSavedEventIdsToMeteorShowers` in `services/eventService.js` called `eventQueries.saveEvent()` **per meteor shower, sequentially, on every request** — 18 showers × a 5-round-trip transaction (BEGIN → upsertEventType → findEventByNaturalKey → updateEvent → COMMIT) ≈ 413ms each = **7.4s of the 8s**. A GET handler was doing ~90 DB writes and bumping `updated_at` on 18 rows per page load.
- Root cause: the loop existed only to resolve each shower's `event_id`, but those rows were **already in memory** — `getNonLaunchEventsInWindow` / `getUpcomingNonLaunchEvents` return them, and the builders then discarded them via `isMeteorShowerEventType`. The shower definitions themselves are static (`MAJOR_SHOWERS` in `meteorService.js`), so nothing needed writing.
- Fix: `attachSavedEventIdsToMeteorShowers(showers, cachedEvents)` builds a natural-key map (`lower(name)|start_time`, mirroring `findEventByNaturalKey`) from the already-fetched rows and resolves ids in memory. `saveEvent()` now runs **only** for a shower with no row yet (first run, or a new year entering the window). Both call sites (`buildTimelineListFromCache`, `buildUpcomingListFromCache`) pass their `events` array.
- Measured: **8.0s → 0.38s warm / 0.99s cold**; queries per request ~92 → 2–4; **writes 0**. Verified identical output by A/B against the unpatched running server: 440 items both, 0 items only-in-old/only-in-new, **0 differing fields**, same ordering. All 18 showers keep an `event_id`, stable across calls; `getUpcomingList` likewise (9 showers, 0 missing).
- ⚠️ Behavior note: existing shower rows are no longer rewritten on each request, so if the curated `MAJOR_SHOWERS` data is edited (description/image/URL), already-persisted rows keep the old values. Only matters for saved events on the profile screen, which read the DB row. Delete the affected `events` rows to force a re-fill if the curated list changes.
- File: `server/services/eventService.js`. No client or schema change.
- ⏳ Not done, deliberately deferred (both dwarfed by the above, worth revisiting now it's fixed): the response is 436KB for a ±365-day window, and `/api/events/list` sends no `Cache-Control`/`ETag`, so every revisit refetches in full.

**Security quick-wins batch (2026-07-25):** audit items #5 (DB SSL, opt-in verification + warning), #6 (login enumeration: unified message + constant-time compare), #8 (error responses no longer leak `err.message`/`err.code`), #9 (removed PII/debug logging), #11 (housekeeping: nodemon→devDeps, removed body-parser + dead `express.static("build")` + unused imports + duplicate `/signup` route). Files: `server/config/database.js`, `server/server.js`, `server/controllers/api/users.js`, `server/models/user.js`, `server/routes/api/users.js`, `server/package.json`. 

**Rate limiting (2026-07-25):** audit item #7 — added `express-rate-limit` with baseline/external/auth limiters (`server/middleware/rateLimit.js`), wired in `server/server.js` + `server/routes/api/users.js`. **New dependency:** `express-rate-limit`. Only remaining flagged security item: #10 (native token persistence — deferred until native ships).


**Security hardening (2026-07-24):**
- ✅ Signup arbitrary `status_id` privilege escalation (audit item #2) — server derives base status, client no longer sends it. Files: `server/models/user.js`, `client/src/pages/signup-screen.tsx`, `client/src/utilities/users-service.ts`.
- ✅ Verified audit item #1 (IDOR on `/api/user-events`) was already resolved in the route layer; only a stale code comment remained.
- ✅ bcrypt cost raised 6 → 12 (audit item #3) with transparent rehash-on-login for existing users. Files: `server/models/user.js`, `server/controllers/api/users.js`.
- ✅ JWT now header-only (audit item #4) — removed `?token=` query fallback. File: `server/config/checkToken.js`.

**Light pollution — real VIIRS data (2026-07-25):**
- ✅ Replaced the city-glow *heuristic* with real VIIRS-derived readings. `lightPollutionService.readViirsLevel()` reads David Lorenz's 2024 atlas tiles (`djlorenz.github.io/.../tiles2024/tile_{z}_{x}_{y}.png`, VIIRS-derived) — the **same tiles the map overlays**, so the viewing score and the on-map overlay now agree. `VIIRS_ENABLED = true`; the heuristic stays as an error-only fallback.
- Approach (decided with owner): decode the tile pixel at (lat,lon) and nearest-match to Lorenz's zone palette → Bortle-like 0..9. Palette (`ZONE_PALETTE`) was sampled from Lorenz's `colorbar.png` legend, so matches are exact (distance 0). Tile grid is `1024·2^z` px, 2^z tiles/axis; we read at zoom 6 (~0.6 km/px) and fall back shallower where a deep tile is absent; missing tile (ocean) → darkest.
- Perf: in-memory LRU tile cache (`MAX_CACHED_TILES=32`, ~1 MB/tile level-maps, immutable data). The best-spot search's 33 concurrent reads dedupe onto shared tiles (~700 ms cold, ~0 ms warm).
- **New dependency (approved):** `pngjs` (pure-JS PNG decoder) added to `server/package.json` — first image lib in the server. Validated against known dark-sky sites (Great Basin, Cherry Springs → level 2–3) and city centers (NYC/LA/Chicago → 9).
- Files: `server/services/lightPollutionService.js`, `server/package.json`. No client change (map already used these tiles).

**Viewing score correctness (2026-07-25):**
- ✅ Fixed: the viewing score ignored real light pollution (both client and server defaulted `light_pollution` to 5, so red-zone locations scored as mid). The score now reads the real VIIRS level server-side via `getLightPollutionAt(lat, lon)` and ignores any client-sent value (client override still accepted but unused). Applies to `/api/score` and `/api/score/summary`.
- ✅ Fixed: the score ignored time of day — a clear afternoon scored ~80. Added a **darkness factor** from the sun's altitude (new pure helper `server/utils/sun.js`, `sunAltitudeDeg` via the SunCalc algorithm). Score is multiplied by 0 (sun at/above horizon) ramping to 1 (sun ≤ −18°, astronomical night). Daytime scores now collapse to 0. The best-spot search is deliberately **not** darkness-gated (it ranks locations, not "is it night now").
- Verified: Cincinnati red zone clear 3pm → 0 (was 83); same at 2am → 75; Great Basin dark site 2am → 91. Best-spot still non-zero regardless of time. Client `tsc` clean.
- Score `inputs` now also returns `sun_altitude_deg` and `darkness_factor` for transparency. Note: light pollution is still only 20% of the score weight — rebalancing is a separate design choice, not a bug.
- **Diagnostic logging** left in `calculateViewingScore` (opt-in via a `logContext` arg, so best-spot stays quiet). Per repo standards, strip these `console.log`s before shipping.
- Files: `server/services/scoreService.js`, `server/services/summaryService.js`, `server/routes/api/score.js`, `server/utils/sun.js`, `client/src/utilities/viewing-score-api.ts`.
- Decision (owner): the **map** best-spot scores stay a *planning* metric (NOT time-gated) — gating them would zero out every spot by day and break the "which spot is best" comparison. Only the dashboard/`/api/score` path is time-gated.
- ✅ UI: added a planning-score caption under the map's "Stargazing Spots" header (`client/src/pages/map-screen.tsx`), and a **viewing-score breakdown** card on the dashboard (`ViewingScoreBreakdown`) showing the number + plain-language drivers (time of day, cloud cover, light pollution) so users understand a low score. The dashboard previously showed no score number, only a greeting. The `/api/score` response now surfaces `sun_altitude_deg` + `darkness_factor` for this. Files: `client/src/pages/dashboard-screen.tsx`, `client/src/utilities/viewing-score-api.ts`.

_(tracker started 2026-07-18 at the beginning of the UI polish pass; earlier feature work predates it and is described in PROJECT_OVERVIEW.md)_
