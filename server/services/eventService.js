// Event service: fill the event cache from SpaceDevs LL2 when a caller requests
// a date window, then return frontend-friendly rows from Supabase/Postgres.

const eventQueries = require("../db/queries/events");
const launchQueries = require("../db/queries/launches");
const locationQueries = require("../db/queries/locations");
const meteorService = require("./meteorService");
const smallBodyService = require("./smallBodyService");
const { isCacheStale, TTL_MINUTES } = require("../middleware/cache");

const LL2_BASE = "https://ll.thespacedevs.com/2.3.0";
const DEFAULT_EVENT_TYPE = "Space Event";
const EVENTS_PAGE_SIZE = 100;
const LL2_THROTTLE_COOLDOWN_MS = 60 * 60 * 1000;
const SMALL_BODY_REFRESH_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const SMALL_BODY_TTL_MINUTES = 6 * 60;
const SMALL_BODY_EVENT_TYPES = ["Asteroid Flyby", "Comet Flyby"];
const SMALL_BODY_TIMELINE_PAST_LIMIT = 30;
const SMALL_BODY_TIMELINE_FUTURE_LIMIT = 60;
const METEOR_SHOWER_EVENT_TYPE = "Meteor Shower";
let eventsRefreshBlockedUntil = 0;
const smallBodyRefreshes = new Map();

function mapCachedEvent(row) {
  const videoUrls = parseUrlList(row.video_url);
  const externalUrls = parseUrlList(row.info_url);

  return {
    id: row.event_id,
    event_id: row.event_id,
    category: "event",
    name: row.name,
    type: row.event_type,
    date: row.start_time,
    end_date: row.end_time,
    date_precision: row.date_precision,
    description: row.description,
    location: null,
    latitude: null,
    longitude: null,
    webcast_live: row.webcast_live,
    video_url: videoUrls[0] || null,
    video_urls: videoUrls,
    external_url: externalUrls[0] || null,
    external_urls: externalUrls,
    image_url: row.image_url,
  };
}

function mapCachedSpacewalkEvent(row) {
  const videoUrls = parseUrlList(row.video_url);
  const externalUrls = parseUrlList(row.info_url);

  return {
    name: row.name,
    start: row.start_time,
    end: row.end_time || null,
    duration: null,
    location: row.location_name || null,
    space_station: row.location_name || null,
    description: row.description || null,
    image_url: row.image_url || null,
    video_url: videoUrls[0] || null,
    video_urls: videoUrls,
    info_url: externalUrls[0] || null,
    external_urls: externalUrls,
    crew: extractEvaCrew(row.description).map((name) => ({ name })),
  };
}

/**
 * Get cached space events from Supabase/Postgres.
 * @param {object} opts
 * @param {number} [opts.limit]
 * @param {string} [opts.fromDate]
 * @param {string} [opts.toDate]
 * @returns {Promise<object>} { count, results }
 */
async function getEvents({ limit, fromDate, toDate } = {}) {
  let events = await eventQueries.getCachedEvents({ limit, fromDate, toDate });
  const latestCachedAt = await eventQueries.getLatestCachedAt({ fromDate, toDate });
  if (events.length > 0 && !isCacheStale(latestCachedAt, TTL_MINUTES.EVENTS)) {
    console.log("\n=== LL2 EVENTS (cache hit) ===");
    return { count: events.length, results: events.map(mapCachedEvent) };
  }

  if (fromDate && toDate) {
    try {
      await cacheExternalEvents({ fromDate, toDate });
      events = await eventQueries.getCachedEvents({ limit, fromDate, toDate });
    } catch (error) {
      if (events.length === 0) throw error;
      console.warn("LL2 events refresh failed; returning stale cache:", error.message);
    }
  }

  const results = events.map(mapCachedEvent);
  return { count: results.length, results };
}

async function cacheExternalEvents({ fromDate, toDate }) {
  const events = await fetchExternalEvents({ fromDate, toDate });
  let saved = 0;

  for (const event of events) {
    try {
      const normalized = await normalizeExternalEvent(event);
      if (!normalized) continue;

      await eventQueries.saveEvent(normalized);
      saved++;
    } catch (error) {
      console.error(`Failed to cache event "${event.name || event.id}":`, error.message);
    }
  }

  if (events.length > 0) {
    console.log(`\n=== LL2 EVENTS CACHE FILL ===\n    Fetched: ${events.length}\n    Saved/skipped idempotently: ${saved}`);
  }
}

async function fetchExternalEvents({ fromDate, toDate }) {
  const params = new URLSearchParams({
    limit: String(EVENTS_PAGE_SIZE),
    mode: "detailed",
    ordering: "date",
    date__gte: toStartOfDay(fromDate),
    date__lte: toEndOfDay(toDate),
  });

  let url = `${LL2_BASE}/events/?${params}`;
  const events = [];

  while (url) {
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      const err = new Error(data?.detail || `LL2 API returned ${response.status}`);
      err.status = response.status;
      throw err;
    }

    events.push(...(data.results || []));
    url = data.next;
  }

  return events;
}

async function normalizeExternalEvent(event) {
  if (!event?.name || !event.date) return null;

  const location = event.location
    ? await locationQueries.findOrCreateLocationByName(event.location)
    : null;
  const videoUrls = collectUrls(event.vid_urls);
  const externalUrls = collectUrls(
    event.info_urls,
    updateInfoUrls(event.updates),
    spacecraftFallbackLinks({ name: event.name, type: event.type?.name })
  );

  return {
    name: event.name,
    startTime: event.date,
    endTime: null,
    datePrecision: event.date_precision?.name || null,
    description: event.description || null,
    eventType: event.type?.name || DEFAULT_EVENT_TYPE,
    webcastLive: event.webcast_live ?? false,
    videoUrl: videoUrls[0] || null,
    infoUrl: externalUrls[0] || null,
    imageUrl: event.image?.image_url || event.image?.thumbnail_url || null,
    locationId: location?.location_id || null,
  };
}

/**
 * Get cached spacewalk/EVA events from the events table.
 * @param {object} opts
 * @param {number} [opts.limit=5]
 * @param {string} [opts.fromDate]
 * @param {string} [opts.toDate]
 */
async function getSpacewalks({ limit = 5, fromDate, toDate } = {}) {
  await refreshExternalEventsForWindow({
    fromDate: fromDate || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
    toDate: toDate || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const rows = await eventQueries.getCachedSpacewalkEvents({
    limit,
    fromDate,
    toDate,
    includePast: !fromDate,
  });

  return {
    count: rows.length,
    results: rows.map(mapCachedSpacewalkEvent),
  };
}

/**
 * Build the unified upcoming-events list from cached DB data. Merges space
 * events and rocket launches into one normalized array,
 * sorted chronologically (soonest first). Consumed by GET /api/events/list.
 *
 * Normalized item:
 *   { id, event_id, category: "event"|"launch", name, type, date, date_precision,
 *     description, image_url, location, latitude, longitude, webcast_live,
 *     video_url, external_url, launch_details }
 *
 * @returns {Promise<Array<object>>}
 */
async function getUpcomingList() {
  const now = new Date();
  const nextYear = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  await refreshExternalEventsForWindow({
    fromDate: now.toISOString(),
    toDate: nextYear.toISOString(),
  });

  const [events, launches] = await Promise.all([
    eventQueries.getUpcomingNonLaunchEvents(),
    launchQueries.getUpcomingLaunches(),
  ]);
  const meteorShowers = await attachSavedEventIdsToMeteorShowers(meteorService.getMeteorShowers({
    fromDate: now.toISOString(),
    toDate: nextYear.toISOString(),
  }).results);

  const normalizedEvents = events.filter((e) => !isMeteorShowerEventType(e.event_type)).map((e) => ({
    id: e.event_id,
    // event_id is the FK target for saving (user_events.event_id). For plain
    // events it equals id; kept as its own field so the client never has to know
    // that launches differ (see below).
    event_id: e.event_id,
    category: "event",
    name: e.name,
    type: e.event_type || "Event",
    date: e.start_time,
    date_precision: e.date_precision,
    description: e.description,
    image_url: e.image_url,
    location: e.location_name || null,
    latitude: null, // LL2 /events/ gives a free-text location with no coords
    longitude: null,
    webcast_live: e.webcast_live ?? false,
    ...normalizeCachedLinks(e),
    launch_details: null,
  }));

  const normalizedLaunches = launches.map((l) => ({
    // Display id stays the launch_id (unique per launch), but event_id is the
    // rocket_launch's underlying events row — THAT is what user_events references.
    id: l.launch_id,
    event_id: l.event_id,
    category: "launch",
    name: l.name,
    type: "Rocket Launch",
    date: l.net,
    date_precision: l.date_precision || l.net_precision,
    description: l.mission_description,
    image_url: l.image_url,
    // Prefer the pad's location; fall back to the pad name if it has no location row.
    location: l.pad_location || l.pad_name || null,
    latitude: l.pad_lat != null ? Number(l.pad_lat) : null,
    longitude: l.pad_lon != null ? Number(l.pad_lon) : null,
    webcast_live: l.webcast_live ?? false,
    ...normalizeCachedLinks(l),
    launch_details: {
      rocket_model: l.rocket_model || null,
      provider: l.provider_name || null,
      mission_name: l.mission_name || null,
      mission_type: l.mission_type || null,
      pad_name: l.pad_name || null,
      pad_location: l.pad_location || null,
      status: l.launch_status || l.status || null,
    },
  }));

  const displayEvents = dedupeEventListItems(normalizedEvents);

  // Merge, then sort chronologically. Items with a missing/invalid date sort last.
  return [...displayEvents, ...normalizedLaunches, ...meteorShowers].sort((a, b) => {
    const ta = a.date ? new Date(a.date).getTime() : Infinity;
    const tb = b.date ? new Date(b.date).getTime() : Infinity;
    return ta - tb;
  });
}

async function getTimelineList({ includePast = false, pastDays = 365, futureDays = 365 } = {}) {
  if (!includePast) return getUpcomingList();

  const now = new Date();
  const windowStart = new Date(now.getTime() - pastDays * 24 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + futureDays * 24 * 60 * 60 * 1000);
  await refreshExternalEventsForWindow({
    fromDate: windowStart.toISOString(),
    toDate: windowEnd.toISOString(),
  });

  const [events, launches] = await Promise.all([
    eventQueries.getNonLaunchEventsInWindow({
      fromDate: windowStart.toISOString(),
      toDate: windowEnd.toISOString(),
      limit: null,
    }),
    launchQueries.getCachedLaunches({
      fromDate: windowStart.toISOString(),
      toDate: windowEnd.toISOString(),
      limit: 400,
    }),
  ]);
  const meteorShowers = await attachSavedEventIdsToMeteorShowers(meteorService.getMeteorShowers({
    fromDate: windowStart.toISOString(),
    toDate: windowEnd.toISOString(),
  }).results);

  const timelineEvents = limitSmallBodyTimelineEvents(
    events.filter((e) => !isMeteorShowerEventType(e.event_type)),
    now
  );

  const normalizedEvents = timelineEvents.map((e) => ({
    id: e.event_id,
    event_id: e.event_id,
    category: "event",
    name: e.name,
    type: e.event_type || "Event",
    date: e.start_time,
    date_precision: e.date_precision,
    description: e.description,
    image_url: e.image_url,
    location: e.location_name || null,
    latitude: null,
    longitude: null,
    webcast_live: e.webcast_live ?? false,
    ...normalizeCachedLinks(e),
    launch_details: null,
  }));

  const normalizedLaunches = launches.map((l) => ({
    id: l.launch_id,
    event_id: l.event_id,
    category: "launch",
    name: l.name,
    type: "Rocket Launch",
    date: l.net,
    date_precision: l.date_precision || l.net_precision,
    description: l.mission_description,
    image_url: l.image_url,
    location: l.pad_location || l.pad_name || null,
    latitude: l.pad_lat != null ? Number(l.pad_lat) : null,
    longitude: (l.pad_lon ?? l.pad_long) != null ? Number(l.pad_lon ?? l.pad_long) : null,
    webcast_live: l.webcast_live ?? false,
    ...normalizeCachedLinks(l),
    launch_details: {
      rocket_model: l.rocket_model || null,
      provider: l.provider_name || null,
      mission_name: l.mission_name || null,
      mission_type: l.mission_type || null,
      pad_name: l.pad_name || null,
      pad_location: l.pad_location || null,
      status: l.launch_status || l.status || null,
    },
  }));

  const displayEvents = dedupeEventListItems(normalizedEvents);

  return [...displayEvents, ...normalizedLaunches, ...meteorShowers].sort((a, b) => {
    const ta = a.date ? new Date(a.date).getTime() : Infinity;
    const tb = b.date ? new Date(b.date).getTime() : Infinity;
    return ta - tb;
  });
}

module.exports = { getEvents, getSpacewalks, getUpcomingList, getTimelineList };

async function refreshExternalEventsForWindow({ fromDate, toDate }) {
  const cachedAt = await eventQueries.getLatestCachedAt({ fromDate, toDate });
  const shouldRefreshLl2 = isCacheStale(cachedAt, TTL_MINUTES.EVENTS) && Date.now() >= eventsRefreshBlockedUntil;

  if (shouldRefreshLl2) {
    try {
      await cacheExternalEvents({ fromDate, toDate });
    } catch (error) {
      if (error.status === 429 || /throttled/i.test(error.message)) {
        eventsRefreshBlockedUntil = Date.now() + LL2_THROTTLE_COOLDOWN_MS;
      }
      console.warn("LL2 events refresh failed; returning cached events:", error.message);
    }
  }

  await refreshSmallBodyEventsForWindow({ fromDate, toDate });
}

async function refreshSmallBodyEventsForWindow({ fromDate, toDate }) {
  const key = `${toDateKey(fromDate)}|${toDateKey(toDate)}`;
  const lastRefresh = smallBodyRefreshes.get(key) || 0;
  if (Date.now() - lastRefresh < SMALL_BODY_REFRESH_COOLDOWN_MS) return;

  const latestCachedAt = await eventQueries.getLatestCachedAtForEventTypes({
    fromDate,
    toDate,
    eventTypes: SMALL_BODY_EVENT_TYPES,
  });
  if (latestCachedAt && !isCacheStale(latestCachedAt, SMALL_BODY_TTL_MINUTES)) {
    smallBodyRefreshes.set(key, Date.now());
    return;
  }

  if (latestCachedAt) {
    smallBodyRefreshes.set(key, Date.now());
    runSmallBodyRefresh({ fromDate, toDate, key }).catch((error) => {
      console.warn("JPL small-body background refresh failed:", error.message);
    });
    return;
  }

  await runSmallBodyRefresh({ fromDate, toDate, key });
}

async function runSmallBodyRefresh({ fromDate, toDate, key }) {
  try {
    const flybys = await smallBodyService.fetchSmallBodyFlybys({ fromDate, toDate });
    let saved = 0;

    for (const flyby of flybys) {
      try {
        await eventQueries.saveEvent(flyby);
        saved++;
      } catch (error) {
        console.error(`Failed to cache small-body event "${flyby.name}":`, error.message);
      }
    }

    smallBodyRefreshes.set(key, Date.now());
    if (flybys.length > 0) {
      console.log(`\n=== JPL SMALL-BODY CACHE FILL ===\n    Fetched: ${flybys.length}\n    Saved/skipped idempotently: ${saved}`);
    }
  } catch (error) {
    smallBodyRefreshes.set(key, Date.now() - SMALL_BODY_REFRESH_COOLDOWN_MS + 60 * 60 * 1000);
    console.warn("JPL small-body refresh failed; returning cached events:", error.message);
  }
}

function limitSmallBodyTimelineEvents(events, now) {
  const smallBody = [];
  const rest = [];

  for (const event of events) {
    if (isSmallBodyEventType(event.event_type)) {
      smallBody.push(event);
    } else {
      rest.push(event);
    }
  }

  const nowMs = now.getTime();
  const past = smallBody.filter((event) => new Date(event.start_time).getTime() < nowMs);
  const future = smallBody.filter((event) => new Date(event.start_time).getTime() >= nowMs);

  return [
    ...rest,
    ...past.slice(-SMALL_BODY_TIMELINE_PAST_LIMIT),
    ...future.slice(0, SMALL_BODY_TIMELINE_FUTURE_LIMIT),
  ].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
}

function isSmallBodyEventType(type) {
  return SMALL_BODY_EVENT_TYPES.includes(String(type || ""));
}

async function attachSavedEventIdsToMeteorShowers(meteorShowers) {
  const persisted = [];

  for (const shower of meteorShowers) {
    try {
      const saved = await eventQueries.saveEvent({
        name: shower.name,
        startTime: shower.date,
        endTime: null,
        datePrecision: shower.date_precision || "Day",
        description: shower.description || null,
        eventType: METEOR_SHOWER_EVENT_TYPE,
        webcastLive: false,
        videoUrl: null,
        infoUrl: shower.external_url || null,
        imageUrl: shower.image_url || null,
        locationId: null,
      });

      persisted.push({
        ...shower,
        id: saved.event_id,
        event_id: saved.event_id,
      });
    } catch (error) {
      console.error(`Failed to persist meteor shower "${shower.name}":`, error.message);
      persisted.push(shower);
    }
  }

  return persisted;
}

function isMeteorShowerEventType(type) {
  return String(type || "") === METEOR_SHOWER_EVENT_TYPE;
}

function dedupeEventListItems(events) {
  const bestByKey = new Map();

  for (const event of events) {
    const day = event.date ? String(event.date).slice(0, 10) : "";
    const key = `${slugify(event.name || "")}|${slugify(event.type || "")}|${day}`;
    const current = bestByKey.get(key);
    if (!current || eventLinkScore(event) > eventLinkScore(current)) {
      bestByKey.set(key, event);
    }
  }

  return [...bestByKey.values()];
}

function eventLinkScore(event) {
  return ((event.video_urls?.length || (event.video_url ? 1 : 0)) * 2) +
    (event.external_urls?.length || (event.external_url ? 1 : 0)) +
    (event.image_url ? 0.5 : 0);
}

function extractEvaCrew(description) {
  const text = String(description || "").trim();
  if (!text) return [];

  const match = text.match(
    /(?:NASA\s+)?astronauts?\s+(.+?)\s+will\b|(?:Russian\s+)?cosmonauts?\s+(.+?)\s+will\b/i
  );
  const namesText = match?.[1] || match?.[2];
  if (!namesText) return [];

  return namesText
    .replace(/\s+and\s+/gi, ", ")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

function firstUrl(value) {
  return collectUrls(value)[0] || null;
}

function updateInfoUrls(updates) {
  if (!Array.isArray(updates)) return null;
  return updates.map((item) => item?.info_url).filter(Boolean);
}

function firstUpdateInfoUrl(updates) {
  return updateInfoUrls(updates)?.[0] || null;
}

function collectUrls(...groups) {
  const urls = [];
  const seen = new Set();

  for (const group of groups) {
    const items = Array.isArray(group) ? group : group ? [group] : [];
    for (const item of items) {
      const url = typeof item === "string" ? item : item?.url || item?.info_url;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
    }
  }

  return urls;
}

function serializeUrlList(urls) {
  const cleanUrls = collectUrls(urls);
  if (cleanUrls.length === 0) return null;
  if (cleanUrls.length === 1) return cleanUrls[0];
  return JSON.stringify(cleanUrls);
}

function parseUrlList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return collectUrls(value);
  const text = String(value).trim();
  if (!text) return [];

  if (text.startsWith("[")) {
    try {
      return collectUrls(JSON.parse(text));
    } catch {
      return [text];
    }
  }

  return [text];
}

function normalizeCachedLinks(row) {
  const videoUrls = parseUrlList(row.video_url);
  const externalUrls = collectUrls(
    parseUrlList(row.info_url),
    spacecraftFallbackLinks({ name: row.name, type: row.event_type || row.type })
  );
  return {
    video_url: videoUrls[0] || null,
    video_urls: videoUrls,
    external_url: externalUrls[0] || null,
    external_urls: externalUrls,
  };
}

function spacecraftFallbackLinks({ name, type }) {
  const text = `${type || ""} ${name || ""}`.toLowerCase();
  const links = [];

  if (
    !text.includes("spacecraft") &&
    !text.includes("docking") &&
    !text.includes("undocking") &&
    !text.includes("berthing") &&
    !text.includes("release") &&
    !text.includes("reentry") &&
    !text.includes("landing")
  ) {
    return links;
  }

  if (text.includes("starliner") || text.includes("boeing")) {
    links.push(
      "https://www.boeing.com/content/theboeingcompany/us/en/space/starliner.html",
      "https://www.nasa.gov/blogs/commercialcrew/2025/11/24/nasa-boeing-modify-commercial-crew-contract/"
    );
  }

  if (text.includes("dream chaser") || text.includes("snc-1") || text.includes("sierra")) {
    links.push(
      "https://www.nasa.gov/missions/station/commercial-resupply/sierra-spaces-dream-chaser-new-station-resupply-spacecraft-for-nasa/",
      "https://www.nasa.gov/missions/station/nasa-sierra-space-modify-commercial-resupply-services-contract/",
      "https://www.faa.gov/space/stakeholder_engagement/shuttle_landing_facility/sierra_operations"
    );
  }

  return links;
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toStartOfDay(value) {
  return isDateOnly(value) ? `${value}T00:00:00Z` : value;
}

function toEndOfDay(value) {
  return isDateOnly(value) ? `${value}T23:59:59Z` : value;
}

function isDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value));
}

function toDateKey(value) {
  return String(value || "").slice(0, 10);
}
