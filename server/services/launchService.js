// Launch service: cache-check -> fetch LL2 /launches/upcoming/ -> transform ->
// persist/update (events + rocket_launch + lookups) -> return cached shape.

const launchQueries = require("../db/queries/launches");
const { isCacheStale, TTL_MINUTES } = require("../middleware/cache");

const LL2_BASES = [
  "https://ll.thespacedevs.com/2.3.0",
  "https://lldev.thespacedevs.com/2.3.0",
];
const LL2_THROTTLE_COOLDOWN_MS = 60 * 60 * 1000;
let launchesRefreshBlockedUntil = 0;

/**
 * Get upcoming rocket launches.
 * @param {object} opts
 * @param {number} [opts.limit=5]
 * @param {string} [opts.fromDate]
 * @param {string} [opts.toDate]
 * @returns {Promise<object>} { count, results }
 */
async function getLaunches({ limit = 5, fromDate, toDate } = {}) {
  const effectiveFromDate = fromDate || new Date().toISOString();
  const cached = await launchQueries.getCachedLaunches({ limit, fromDate: effectiveFromDate, toDate });
  const hasStaleCachedLaunch = cached.some((launch) =>
    isCacheStale(launch.cached_at, TTL_MINUTES.LAUNCHES)
  );
  if (cached.length > 0 && !hasStaleCachedLaunch) {
    console.log("\n=== UPCOMING ROCKET LAUNCHES (cache hit) ===");
    return { count: cached.length, results: cached.map(mapCachedLaunch) };
  }
  if (cached.length > 0 && Date.now() < launchesRefreshBlockedUntil) {
    return { count: cached.length, results: cached.map(mapCachedLaunch) };
  }

  const params = new URLSearchParams({
    format: "json",
    limit: String(limit),
    mode: "detailed",
    hide_recent_previous: "true",
    ordering: "net",
  });
  params.set("net__gte", toStartOfDay(effectiveFromDate));
  if (toDate) params.set("net__lte", toEndOfDay(toDate));

  let data;
  let lastFetchError;
  try {
    for (const baseUrl of LL2_BASES) {
      try {
        const response = await fetch(`${baseUrl}/launches/upcoming/?${params}`);
        const body = await response.json();
        if (!response.ok) {
          const err = new Error(body?.detail || `LL2 API returned ${response.status}`);
          err.status = response.status;
          throw err;
        }
        data = body;
        break;
      } catch (error) {
        lastFetchError = error;
        if (!(error.status === 429 || /throttled|too many requests/i.test(error.message))) {
          throw error;
        }
      }
    }
    if (!data) throw lastFetchError || new Error("LL2 launch fetch failed");
  } catch (error) {
    if (error.status === 429 || /throttled|too many requests/i.test(error.message)) {
      launchesRefreshBlockedUntil = Date.now() + LL2_THROTTLE_COOLDOWN_MS;
    }
    if (cached.length > 0) {
      console.warn("LL2 launches refresh failed; returning cached launches:", error.message);
      return { count: cached.length, results: cached.map(mapCachedLaunch) };
    }
    throw error;
  }

  // Transform to the frontend shape (same fields as the original route).
  const launches = (data.results || []).map((l) => ({
    name: l.name,
    url: l.url || null,
    status: l.status?.name,
    net: l.net,
    net_precision: l.net_precision?.name,
    mission: l.mission
      ? { name: l.mission.name, type: l.mission.type, description: l.mission.description }
      : null,
    pad: l.pad
      ? {
          name: l.pad.name,
          location: l.pad.location?.name,
          latitude: l.pad.latitude,
          longitude: l.pad.longitude,
          country: l.pad.country?.name,
        }
      : null,
    provider: l.launch_service_provider?.name,
    rocket: l.rocket?.configuration?.name,
    image: l.image?.image_url || null,
    webcast_live: Boolean(l.webcast_live),
    video_urls: collectUrls(l.vid_urls, l.mission?.vid_urls),
    external_urls: collectUrls(l.info_urls, l.mission?.info_urls, updateInfoUrls(l.updates)),
  }));

  console.log("\n=== UPCOMING ROCKET LAUNCHES ===");
  launches.forEach((l, i) => {
    console.log(`\n[${i + 1}] ${l.name}`);
    console.log(`    Status   : ${l.status}`);
    console.log(`    Launch   : ${l.net} (precision: ${l.net_precision})`);
    console.log(`    Rocket   : ${l.rocket} — ${l.provider}`);
    console.log(`    Pad      : ${l.pad?.name}`);
    console.log(`    Location : ${l.pad?.location} (${l.pad?.country})`);
    console.log(`    Coords   : ${l.pad?.latitude}, ${l.pad?.longitude}`);
    if (l.mission) console.log(`    Mission  : ${l.mission.name} [${l.mission.type}]`);
  });

  // Persist each launch: events row first, then rocket_launch (+ lookups).
  for (const l of launches) {
    try {
      // De-dup defensively by name (no idempotency key in schema yet).
      const existing = await launchQueries.findLaunchByName(l.name);

      const eventData = {
        name: l.name,
        startTime: l.net, // events.start_time = launch NET (no-earlier-than)
        endTime: null,
        datePrecision: l.net_precision,
        description: l.mission?.description || null,
        eventType: "Launch", // upserted into event_types
        webcastLive: l.webcast_live,
        videoUrl: l.video_urls[0] || null,
        infoUrl: l.external_urls[0] || null,
        imageUrl: l.image,
      };

      const launchData = {
        name: l.name,
        status: l.status,
        netPrecision: l.net_precision,
        imageUrl: l.image,
        mission: l.mission
          ? { name: l.mission.name, missionType: l.mission.type, description: l.mission.description }
          : null,
        rocket: l.rocket ? { model: l.rocket, manufacturer: l.provider, description: null } : null,
        provider: l.provider ? { name: l.provider } : null,
        launchStatus: l.status ? { status: l.status } : null,
        pad: l.pad
          ? {
              name: l.pad.name,
              location: {
                name: l.pad.location,
                lat: l.pad.latitude,
                long: l.pad.longitude,
                country: l.pad.country,
              },
            }
          : null,
      };

      if (existing) {
        await launchQueries.refreshLaunchByName(l.name, eventData, launchData);
      } else {
        await launchQueries.saveLaunch(eventData, launchData);
      }
    } catch (saveErr) {
      // Don't fail the whole request if one launch fails to persist.
      console.error(`Failed to save launch "${l.name}":`, saveErr.message);
    }
  }

  const refreshed = await launchQueries.getCachedLaunches({ limit, fromDate: effectiveFromDate, toDate });
  return { count: refreshed.length, results: refreshed.map(mapCachedLaunch) };
}

async function getLaunchLinks({ name, date } = {}) {
  if (!name) {
    const error = new Error("name is required");
    error.status = 400;
    throw error;
  }

  const params = new URLSearchParams({
    format: "json",
    limit: "25",
    mode: "detailed",
    search: name,
  });

  if (date) {
    const center = new Date(date);
    if (!Number.isNaN(center.getTime())) {
      const from = new Date(center.getTime() - 14 * 24 * 60 * 60 * 1000);
      const to = new Date(center.getTime() + 14 * 24 * 60 * 60 * 1000);
      params.set("net__gte", from.toISOString());
      params.set("net__lte", to.toISOString());
    }
  }

  const data = await fetchLaunchesFromSpaceDevs(params);
  const launches = data.results || [];
  const match = findBestLaunchMatch(launches, { name, date });
  const videoUrls = collectUrls(match?.vid_urls, match?.mission?.vid_urls);
  const externalUrls = collectUrls(match?.info_urls, match?.mission?.info_urls, updateInfoUrls(match?.updates));

  return {
    name: match?.name || name,
    video_url: videoUrls[0] || null,
    video_urls: videoUrls,
    external_url: externalUrls[0] || null,
    external_urls: externalUrls,
  };
}

module.exports = { getLaunches, getLaunchLinks };

async function fetchLaunchesFromSpaceDevs(params) {
  let lastFetchError;

  for (const baseUrl of LL2_BASES) {
    try {
      const response = await fetch(`${baseUrl}/launches/upcoming/?${params}`);
      const body = await response.json();
      if (!response.ok) {
        const err = new Error(body?.detail || `LL2 API returned ${response.status}`);
        err.status = response.status;
        throw err;
      }
      return body;
    } catch (error) {
      lastFetchError = error;
      if (!(error.status === 429 || /throttled|too many requests/i.test(error.message))) {
        throw error;
      }
    }
  }

  throw lastFetchError || new Error("LL2 launch fetch failed");
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

function mapCachedLaunch(row) {
  const videoUrls = parseUrlList(row.video_url);
  const externalUrls = parseUrlList(row.info_url);

  return {
    id: row.launch_id,
    launch_id: row.launch_id,
    event_id: row.event_id,
    category: "launch",
    name: row.name,
    status: row.status || row.launch_status,
    net: row.net,
    net_precision: row.net_precision || row.date_precision,
    date: row.net,
    date_precision: row.date_precision || row.net_precision,
    description: row.mission_description,
    location: row.pad_location || row.pad_name || null,
    latitude: row.pad_lat == null ? null : Number(row.pad_lat),
    longitude: row.pad_long == null ? null : Number(row.pad_long),
    webcast_live: row.webcast_live ?? false,
    video_url: videoUrls[0] || null,
    video_urls: videoUrls,
    external_url: externalUrls[0] || null,
    external_urls: externalUrls,
    mission: row.mission_name
      ? {
          name: row.mission_name,
          type: row.mission_type,
          description: row.mission_description,
        }
      : null,
    pad: row.pad_name
      ? {
          name: row.pad_name,
          location: row.pad_location,
          latitude: row.pad_lat,
          longitude: row.pad_long,
          country: row.pad_country,
        }
      : null,
    provider: row.provider_name,
    rocket: row.rocket_model,
    image: row.image_url || null,
    image_url: row.image_url || null,
    launch_details: {
      rocket_model: row.rocket_model || null,
      provider: row.provider_name || null,
      mission_name: row.mission_name || null,
      mission_type: row.mission_type || null,
      pad_name: row.pad_name || null,
      pad_location: row.pad_location || null,
      status: row.status || row.launch_status || null,
    },
  };
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

function findBestLaunchMatch(launches, { name, date }) {
  if (!Array.isArray(launches) || launches.length === 0) return null;
  const normalizedName = normalizeText(name);
  const targetTime = date ? new Date(date).getTime() : NaN;

  return launches.find((launch) =>
    normalizeText(launch.name) === normalizedName &&
    datesAreClose(launch.net, targetTime)
  ) || launches.find((launch) =>
    normalizeText(launch.name) === normalizedName
  ) || launches[0];
}

function datesAreClose(value, targetTime) {
  if (!Number.isFinite(targetTime)) return true;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return true;
  return Math.abs(time - targetTime) < 60 * 1000;
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}
