// Event service: fill the event cache from SpaceDevs LL2 when a caller requests
// a date window, then return frontend-friendly rows from Supabase/Postgres.

const eventQueries = require("../db/queries/events");
const launchQueries = require("../db/queries/launches");
const locationQueries = require("../db/queries/locations");
const meteorService = require("./meteorService");
const { isCacheStale, TTL_MINUTES } = require("../middleware/cache");

const LL2_BASE = "https://lldev.thespacedevs.com/2.3.0";
const DEFAULT_EVENT_TYPE = "Space Event";
const EVENTS_PAGE_SIZE = 100;

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
    image_url: row.image_url,
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

  return {
    name: event.name,
    startTime: event.date,
    endTime: null,
    datePrecision: event.date_precision?.name || null,
    description: event.description || null,
    eventType: event.type?.name || DEFAULT_EVENT_TYPE,
    webcastLive: event.webcast_live ?? false,
    videoUrl: primaryVideo?.url || null,
    imageUrl: event.image?.image_url || event.image?.thumbnail_url || null,
    locationId: location?.location_id || null,
  };
}

/**
 * Get recent spacewalks (EVAs).
 *
 * NOTE: there is no spacewalk table in the schema, so this is NOT persisted.
 * @param {object} opts
 * @param {number} [opts.limit=5]
 * @param {string} [opts.fromDate]
 * @param {string} [opts.toDate]
 */
async function getSpacewalks({ limit = 5, fromDate, toDate } = {}) {
  const params = new URLSearchParams({
    limit: String(limit),
    ordering: "-start",
  });
  if (fromDate) params.set("start__gte", toStartOfDay(fromDate));
  if (toDate) params.set("start__lte", toEndOfDay(toDate));

  const response = await fetch(`${LL2_BASE}/spacewalks/?${params}`);
  if (!response.ok) {
    const err = new Error(`LL2 API returned ${response.status}`);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();

  const spacewalks = (data.results || []).map((s) => ({
    name: s.name,
    start: s.start,
    end: s.end,
    duration: s.duration,
    location: s.location,
    space_station: s.space_station?.name || null,
    crew: (s.crew || []).map((c) => ({
      name: c.astronaut?.name,
      nationality: c.astronaut?.nationality,
      role: c.role?.role,
    })),
  }));

  return { count: data.count, results: spacewalks };
}

/**
 * Build the unified upcoming-events list from CACHED DB data only (no external
 * API calls). Merges space events and rocket launches into one normalized array,
 * sorted chronologically (soonest first). Consumed by GET /api/events/list.
 *
 * Normalized item:
 *   { id, event_id, category: "event"|"launch", name, type, date, date_precision,
 *     description, image_url, location, latitude, longitude, webcast_live,
 *     video_url, launch_details }
 *
 * @returns {Promise<Array<object>>}
 */
async function getUpcomingList() {
  const now = new Date();
  const nextYear = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
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

  // Merge, then sort chronologically. Items with a missing/invalid date sort last.
  return [...normalizedEvents, ...normalizedLaunches, ...meteorShowers].sort((a, b) => {
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

  return [...normalizedEvents, ...normalizedLaunches, ...meteorShowers].sort((a, b) => {
    const ta = a.date ? new Date(a.date).getTime() : Infinity;
    const tb = b.date ? new Date(b.date).getTime() : Infinity;
    return ta - tb;
  });
}

module.exports = { getEvents, getSpacewalks, getUpcomingList, getTimelineList };

function toStartOfDay(value) {
  return isDateOnly(value) ? `${value}T00:00:00Z` : value;
}

function toEndOfDay(value) {
  return isDateOnly(value) ? `${value}T23:59:59Z` : value;
}

function isDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value));
}
