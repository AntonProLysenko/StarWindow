// Event service: fill the event cache from SpaceDevs LL2 when a caller requests
// a date window, then return frontend-friendly rows from Supabase/Postgres.

const eventQueries = require("../db/queries/events");
const launchQueries = require("../db/queries/launches");
const locationQueries = require("../db/queries/locations");
const meteorService = require("./meteorService");
const { isCacheStale, TTL_MINUTES } = require("../middleware/cache");

const LL2_BASE = "https://ll.thespacedevs.com/2.3.0";
const DEFAULT_EVENT_TYPE = "Space Event";
const EVENTS_PAGE_SIZE = 100;
const LL2_THROTTLE_COOLDOWN_MS = 60 * 60 * 1000;
let eventsRefreshBlockedUntil = 0;

function mapCachedEvent(row) {
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
    video_url: row.video_url || null,
    video_urls: row.video_url ? [row.video_url] : [],
    external_url: row.info_url || null,
    image_url: row.image_url,
  };
}

function mapCachedSpacewalkEvent(row) {
  return {
    name: row.name,
    start: row.start_time,
    end: row.end_time || null,
    duration: null,
    location: row.location_name || null,
    space_station: row.location_name || null,
    description: row.description || null,
    image_url: row.image_url || null,
    video_url: row.video_url || null,
    info_url: row.info_url || null,
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
  const primaryVideo = Array.isArray(event.vid_urls) ? event.vid_urls[0] : null;
  const primaryInfoUrl = firstUrl(event.info_urls) || firstUpdateInfoUrl(event.updates);

  return {
    name: event.name,
    startTime: event.date,
    endTime: null,
    datePrecision: event.date_precision?.name || null,
    description: event.description || null,
    eventType: event.type?.name || DEFAULT_EVENT_TYPE,
    webcastLive: event.webcast_live ?? false,
    videoUrl: primaryVideo?.url || null,
    infoUrl: primaryInfoUrl || null,
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
  const meteorShowers = meteorService.getMeteorShowers({
    fromDate: now.toISOString(),
    toDate: nextYear.toISOString(),
  }).results;

  const normalizedEvents = events.map((e) => ({
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
    video_url: e.video_url || null,
    external_url: e.info_url || null,
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
    video_url: l.video_url || null,
    external_url: l.info_url || null,
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
      limit: 400,
    }),
    launchQueries.getCachedLaunches({
      fromDate: windowStart.toISOString(),
      toDate: windowEnd.toISOString(),
      limit: 400,
    }),
  ]);
  const meteorShowers = meteorService.getMeteorShowers({
    fromDate: windowStart.toISOString(),
    toDate: windowEnd.toISOString(),
  }).results;

  const normalizedEvents = events.map((e) => ({
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
    video_url: e.video_url || null,
    external_url: e.info_url || null,
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
    video_url: l.video_url || null,
    external_url: l.info_url || null,
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
  if (!isCacheStale(cachedAt, TTL_MINUTES.EVENTS)) return;
  if (Date.now() < eventsRefreshBlockedUntil) return;

  try {
    await cacheExternalEvents({ fromDate, toDate });
  } catch (error) {
    if (error.status === 429 || /throttled/i.test(error.message)) {
      eventsRefreshBlockedUntil = Date.now() + LL2_THROTTLE_COOLDOWN_MS;
    }
    console.warn("LL2 events refresh failed; returning cached events:", error.message);
  }
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
  return (event.video_url ? 2 : 0) + (event.external_url ? 1 : 0) + (event.image_url ? 0.5 : 0);
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
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    if (typeof item === "string" && item) return item;
    if (item?.url) return item.url;
    if (item?.info_url) return item.info_url;
  }
  return null;
}

function firstUpdateInfoUrl(updates) {
  if (!Array.isArray(updates)) return null;
  const update = updates.find((item) => item?.info_url);
  return update?.info_url || null;
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
