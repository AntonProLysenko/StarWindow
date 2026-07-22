# StarWindow — Project Overview

## What Is This

StarWindow is a multiplatform stargazing app. Users see celestial events and rocket launches, moon phases, ISS passes, space news, current weather, a 0–100 "viewing score" for their location, and a light-pollution map that finds the best nearby stargazing spot. Web-first (react-native-web), with iOS/Android as later targets via Expo.

The repo is a two-package monorepo — there is no root `package.json`; `client/` and `server/` are installed and run separately.

```
/client     ← Expo (React Native) app, TypeScript, expo-router
/server     ← Express 5 API, CommonJS JavaScript, Postgres (Supabase)
/context    ← this folder, AI reference docs
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Expo SDK 56, React 19, React Native 0.85, TypeScript, expo-router (file-based routing) |
| Web map | Leaflet + react-leaflet (web-only, `*.web.tsx` variants) |
| Styling | `StyleSheet.create` + design tokens in `client/src/constants/tokens.ts`; web-only `dvw()`/`dvh()` viewport sizing in `utilities/responsive-dimensions.ts` (NativeWind deferred) |
| Backend | Node.js, Express 5, CommonJS (`require`) |
| Database | Supabase Postgres via `pg` Pool — raw SQL, no ORM |
| Auth | JWT (`jsonwebtoken`, 24h expiry) + bcryptjs; token stored client-side in localStorage |
| Caching | Postgres tables with `cached_at` timestamps + TTL check in `server/middleware/cache.js` (no Redis) |
| Environment | dotenv; client uses `EXPO_PUBLIC_API_URL` |

## External APIs (all proxied through the server)

| API | Used by | Env var |
|-----|---------|---------|
| Launch Library 2 (lldev.thespacedevs.com) | `launchService`, `eventService` | none (dev tier) |
| AstronomyAPI (api.astronomyapi.com) | `astronomyService` (body positions, moon phase) | `Astronomy_API_ID`, `Astronomy_API_Secret` |
| OpenWeatherMap (weather + geocoding) | `weatherService` | `OpenWeatherMap_API_KEY` |
| NASA APIs (APOD, DONKI, Images, news feed) | `newsService` | `NASA_API_KEY` |
| NASA SVS Dial-a-Moon | `astronomyService` | none |
| iss-api.fly.dev | `issService` | none |
| VIIRS light-pollution data (eogdata.mines.edu) | `lightPollutionService` (currently a city-glow fallback heuristic; `VIIRS_ENABLED` flag) | none |
| ipapi.co | client `user-location-service` fallback when browser/device location is denied | none |

Server env vars also include: `DATABASE_URL` (Supabase connection string), `SECRET` (JWT signing), `PORT` (default 3001). Both `.env` files live in `client/` and `server/` and are gitignored.

---

## Core Systems

### Auth
- `POST /api/users` (or `/signup`) and `/login` issue a JWT; `config/checkToken.js` decodes it globally into `req.user`; `config/ensureLoggedIn.js` guards protected routes.
- Client: `src/utilities/users-service.ts` stores/decodes the token (localStorage on web, in-memory fallback elsewhere) and notifies subscribers on auth changes.

### Cache-through data pipeline (the server's core pattern)
Every external data source follows the same flow:
`route → service → (db/queries getCached* + isCacheStale(TTL)) → external API if stale → save to Postgres → return`.
TTLs are centralized in `server/middleware/cache.js` (`TTL_MINUTES`). The DB schema (17+ tables: events, rocket_launch, missions, rockets, pads, providers, locations, body_positions, moon_phases, iss_passes, weather, news_articles, users, user_events, user_event_types, leveling tables, plus lookups) lives in Supabase — introspect directly (the schema-guide dump was removed upstream); known schema gaps are tracked in `server/db/TODO.md`.

### Leveling (added upstream 2026-07-18)
Users earn points for actions (e.g. saving events) via `server/db/queries/leveling.js` (`awardUserPoints`/`reverseUserPoints`, idempotent per source key); the client shows level progress via `utilities/level-progress.ts` on the profile/dashboard.

### Events & launches
- Unified list endpoint `GET /api/events/list` merges cached space events + rocket launches into one normalized shape (`EventListItem` on the client).
- Users can save events (`user_events` table) with comment + 1–5 rating; saved events show on the profile screen.
- Users pick preferred event types (`user_event_types`) via `/api/users/event-types`.

### Viewing score & map
- `scoreService` computes a 0–100 score from cloud cover, visibility, and light pollution; `summaryService` bundles weather + ISS + launches + events + bodies + score into one payload.
- `bestSpotService` samples concentric rings around the user, scores each point, returns the best spot (distance, bearing, drive time — helpers in `server/utils/geo.js`).
- Client map screen renders Leaflet with launch-pad markers, light-pollution overlay, and a radius slider.

### Client screens (expo-router routes in `client/src/app/`)
| Route | Screen | Notes |
|-------|--------|-------|
| `/` (index) | Dashboard (locked preview) | `pages/dashboard-screen.tsx` — moon hero, calendar/map/launches/profile preview cards |
| `/dashboard` | Dashboard (full) | same component |
| `/login`, `/signup` | Auth screens | animated space theme |
| `/events` | Unified events list + modal | screen lives directly in `app/events.tsx` (unlike others) |
| `/calendar` | Month grid of events | `pages/calendar.tsx` |
| `/map` | Light pollution / best-spot map | web Leaflet impl in `components/star-map/` |
| `/profile` | Profile + saved events + event-type prefs | `pages/profile-screen.tsx` |
| `/explore` | Dead template code (fully commented out) | candidate for deletion |

`_layout.tsx` shows `AppSidebar` for logged-in users on all routes except login/signup.

---

## How to Run

```bash
# server (port 3001)
cd server && npm install && npm run dev

# client (Expo web)
cd client && npm install && npm run web
```

Client expects `EXPO_PUBLIC_API_URL` (e.g. `http://localhost:3001`) in `client/.env`.

---

## Current Phase

Feature-complete first pass of all major screens; current focus is **UI polish** (see `PROGRESS_TRACKER.md`) — responsive layout, one styling system, one color/token source, and cleanup of template leftovers — plus the security/consistency items flagged in the tracker.
