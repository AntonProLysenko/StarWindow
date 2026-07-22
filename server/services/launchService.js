// Launch service: cache-check -> fetch LL2 /launches/upcoming/ -> transform ->
// persist/update (events + rocket_launch + lookups) -> return cached shape.

const launchQueries = require("../db/queries/launches");
const { isCacheStale, TTL_MINUTES } = require("../middleware/cache");

const LL2_BASE = "https://lldev.thespacedevs.com/2.3.0";

/**
 * Get upcoming rocket launches.
 * @param {object} opts
 * @param {number} [opts.limit=5]
 * @param {string} [opts.fromDate]
 * @param {string} [opts.toDate]
 * @returns {Promise<object>} { count, results }
 */
async function getLaunches({ limit = 5, fromDate, toDate } = {}) {
  const cached = await launchQueries.getCachedLaunches({ limit, fromDate, toDate });
  const hasStaleCachedLaunch = cached.some((launch) =>
    isCacheStale(launch.cached_at, TTL_MINUTES.LAUNCHES)
  );
  if (cached.length > 0 && !hasStaleCachedLaunch) {
    console.log("\n=== UPCOMING ROCKET LAUNCHES (cache hit) ===");
    return { count: cached.length, results: cached.map(mapCachedLaunch) };
  }

  const params = new URLSearchParams({
    limit: String(limit),
    mode: "detailed",
  });
  if (fromDate) params.set("net__gte", toStartOfDay(fromDate));
  if (toDate) params.set("net__lte", toEndOfDay(toDate));

  const response = await fetch(`${LL2_BASE}/launches/upcoming/?${params}`);
  if (!response.ok) {
    const err = new Error(`LL2 API returned ${response.status}`);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();

  // Transform to the frontend shape (same fields as the original route).
  const launches = (data.results || []).map((l) => ({
    name: l.name,
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
        webcastLive: null, // LL2 /launches doesn't expose a live flag here
        videoUrl: null,
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

  const refreshed = await launchQueries.getCachedLaunches({ limit, fromDate, toDate });
  return { count: refreshed.length, results: refreshed.map(mapCachedLaunch) };
}

module.exports = { getLaunches };

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
    video_url: row.video_url || null,
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
