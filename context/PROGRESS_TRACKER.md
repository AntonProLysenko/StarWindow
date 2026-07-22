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
- ⏳ Only `pages/calendar.tsx` adapts to width (`useWindowDimensions`); dashboard, events, profile, map assume desktop
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

1. 📝 **IDOR on `/api/user-events`** — GET/POST trust `user_id` from query/body; DELETE has no ownership check. Should use `req.user.user_id` + `ensureLoggedIn` (the route file itself notes this as a follow-up).
2. 📝 **Signup accepts arbitrary `status_id`** from the request body (`User.create(req.body)`) — a client can self-assign any user status.
3. 📝 **bcrypt `SALT_ROUNDS = 6`** in `models/user.js` — below the ~10–12 standard.
4. 📝 **JWT accepted via `?token=` query param** in `config/checkToken.js` — tokens leak into logs/history; header-only is safer.
5. 📝 **`ssl: { rejectUnauthorized: false }`** for the Supabase connection in `config/database.js`.
6. 📝 **Login user enumeration** — distinct "Invalid email" vs "Invalid email or password" responses in `controllers/api/users.js`.
7. 📝 **No rate limiting / abuse protection** on auth or on unauthenticated routes that spend paid external API quota (`/api/news?refresh=true` bypasses cache on demand; astronomy/weather endpoints are open).
8. 📝 **Error responses leak internals** — `err.message` + `err.code` (Postgres codes) returned to clients on 400s.
9. 📝 **PII/debug logging** — emails logged on signup/login; `checkToken` controller logs the whole `req.user`.
10. 📝 **Auth doesn't persist on native** — `users-service.ts` falls back to in-memory token storage when `localStorage` is missing (needs AsyncStorage/SecureStore before native ships).
11. 📝 Housekeeping: `nodemon` is in `dependencies`; `body-parser`/`ensureLoggedIn` imported unused in `server.js`; `express.static("build")` serves a folder that doesn't exist; duplicate signup routes (`POST /` and `POST /signup`).

---

## Completed

_(nothing tracked yet — tracker started 2026-07-18 at the beginning of the UI polish pass; earlier feature work predates it and is described in PROJECT_OVERVIEW.md)_
