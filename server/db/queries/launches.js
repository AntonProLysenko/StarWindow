// Queries for rocket launches. A launch IS an event (rocket_launch.event_id is a
// UNIQUE FK to events) plus launch-specific fields, so saveLaunch() inserts the
// events row FIRST, gets event_id back, then inserts rocket_launch referencing it.
//
// Tables touched (7):
//   events            — the base event row (via the shared events.js helpers)
//   event_types       — upsert the "Launch" type
//   missions(mission_id PK, name, mission_type, description)
//   rockets(rocket_id PK, model, manufacturer, description)
//   providers(provider_id PK, name)
//   launch_statuses(launch_status_id PK, status)
//   pads(pad_id PK, name, location_id FK)
//   rocket_launch(launch_id PK, event_id FK UNIQUE, name, status, net_precision,
//     mission_id FK, rocket_id FK, provider_id FK, launch_status_id FK, pad_id FK,
//     image_url)
//
// There is still no LL2 UUID natural key in the schema, so launch refreshes are
// matched defensively by name.
//

const database = require("../../config/database");
const eventQueries = require("./events");

module.exports = {
  getCachedLaunches,
  getUpcomingLaunches,
  saveLaunch,
  findLaunchByName,
  refreshLaunchByName,
};

/**
 * Return cached launches joined with their lookups + base event, soonest first.
 * @param {object|number} [opts]
 * @param {number} [opts.limit=20]
 * @param {string} [opts.fromDate]
 * @param {string} [opts.toDate]
 */
async function getCachedLaunches(opts = {}) {
  const { limit = 20, fromDate, toDate } =
    typeof opts === "number" ? { limit: opts } : opts || {};
  const values = [];
  const where = [];

  if (fromDate) {
    values.push(fromDate);
    where.push(`e.start_time >= $${values.length}::timestamptz`);
  }

  if (toDate) {
    values.push(toDate);
    where.push(`e.start_time < ($${values.length}::date + INTERVAL '1 day')`);
  }

  values.push(limit);
  const limitPlaceholder = `$${values.length}`;

  const result = await database.query(
    `
      SELECT
        rl.launch_id, rl.event_id, rl.name, rl.status, rl.net_precision,
        rl.image_url, rl.cached_at,
        e.start_time AS net, e.date_precision, e.webcast_live, e.video_url, e.info_url,
        m.name AS mission_name, m.mission_type, m.description AS mission_description,
        r.model AS rocket_model, r.manufacture AS rocket_manufacturer,
        p.name AS provider_name,
        ls.status AS launch_status,
        pad.name AS pad_name,
        loc.name AS pad_location, loc.lat AS pad_lat, loc.long AS pad_long, loc.country AS pad_country
      FROM public.rocket_launch rl
      JOIN public.events e ON e.event_id = rl.event_id
      LEFT JOIN public.missions m ON m.mission_id = rl.mission_id
      LEFT JOIN public.rockets r ON r.rocket_id = rl.rocket_id
      LEFT JOIN public.providers p ON p.provider_id = rl.provider_id
      LEFT JOIN public.launch_statuses ls ON ls.launch_status_id = rl.launch_status_id
      LEFT JOIN public.pads pad ON pad.pad_id = rl.pad_id
      LEFT JOIN public.locations loc ON loc.location_id = pad.location_id
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY e.start_time ASC
      LIMIT ${limitPlaceholder}
    `,
    values
  );
  return result.rows;
}

/**
 * Return UPCOMING cached launches (base event start_time >= now), soonest first.
 * Same projection as getCachedLaunches, just filtered to future launches — used
 * by the unified events list so past launches don't show up.
 * @param {number} [limit=200]
 */
async function getUpcomingLaunches(limit = 200) {
  const result = await database.query(
    `
      SELECT * FROM (
        SELECT DISTINCT ON (rl.name, e.start_time)
          rl.launch_id, rl.event_id, rl.name, rl.status, rl.net_precision,
          rl.image_url,
          e.start_time AS net, e.date_precision, e.webcast_live, e.video_url, e.info_url,
          m.name AS mission_name, m.mission_type, m.description AS mission_description,
          r.model AS rocket_model,
          p.name AS provider_name,
          ls.status AS launch_status,
          pad.name AS pad_name,
          loc.name AS pad_location, loc.lat AS pad_lat, loc.long AS pad_lon
        FROM public.rocket_launch rl
        JOIN public.events e ON e.event_id = rl.event_id
        LEFT JOIN public.missions m ON m.mission_id = rl.mission_id
        LEFT JOIN public.rockets r ON r.rocket_id = rl.rocket_id
        LEFT JOIN public.providers p ON p.provider_id = rl.provider_id
        LEFT JOIN public.launch_statuses ls ON ls.launch_status_id = rl.launch_status_id
        LEFT JOIN public.pads pad ON pad.pad_id = rl.pad_id
        LEFT JOIN public.locations loc ON loc.location_id = pad.location_id
        WHERE e.start_time >= now()
        -- DISTINCT ON collapses launches that got inserted more than once
        -- (dedup guard was added after some dupes already existed); keep lowest id.
        ORDER BY rl.name, e.start_time, rl.launch_id
      ) uniq
      ORDER BY uniq.net ASC
      LIMIT $1
    `,
    [limit]
  );
  return result.rows;
}

/** Quick existence check used by the service to avoid duplicate inserts. */
async function findLaunchByName(name) {
  const result = await database.query(
    "SELECT launch_id, event_id FROM public.rocket_launch WHERE name = $1 LIMIT 1",
    [name]
  );
  return result.rows[0] || null;
}

/**
 * Persist a launch: upsert lookups, insert event, then insert rocket_launch.
 * Everything runs on one pg client inside a single transaction so it commits
 * atomically (or rolls back entirely on error).
 *
 * @param {object} eventData - base event fields:
 *   { name, startTime, endTime, datePrecision, description, eventType,
   *     webcastLive, videoUrl, infoUrl, imageUrl }
 * @param {object} launchData - launch-specific fields:
 *   { name, status, netPrecision, imageUrl,
 *     mission:{name, missionType, description},
 *     rocket:{model, manufacturer, description},
 *     provider:{name},
 *     launchStatus:{status},
 *     pad:{name, location:{name, lat, long, country}} }
 * @returns {Promise<object>} { event_id, launch_id }
 */
async function saveLaunch(eventData, launchData) {
  const client = await database.connect();
  try {
    await client.query("BEGIN");

    // 1) Upsert lookups first to get their IDs.
    const missionId = await upsertMission(client, launchData.mission);
    const rocketId = await upsertRocket(client, launchData.rocket);
    const providerId = await upsertProvider(client, launchData.provider);
    const launchStatusId = await upsertLaunchStatus(client, launchData.launchStatus);
    const padId = await upsertPad(client, launchData.pad);

    // 2) Upsert the event_type, then insert the base event row (reusing the
    //    shared events.js helpers on THIS client so it's all one transaction).
    const typeId = eventData.eventType
      ? await eventQueries.upsertEventType(eventData.eventType, client)
      : null;
    const event = await eventQueries.insertEvent({ ...eventData, typeId }, client);

    // 3) Insert rocket_launch referencing the new event_id + all FKs.
    const launch = await client.query(
      `
        INSERT INTO public.rocket_launch
          (event_id, name, status, net_precision, mission_id, rocket_id,
           provider_id, launch_status_id, pad_id, image_url, cached_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
        RETURNING launch_id, event_id
      `,
      [
        event.event_id,
        launchData.name,
        launchData.status || null,
        launchData.netPrecision || null,
        missionId,
        rocketId,
        providerId,
        launchStatusId,
        padId,
        launchData.imageUrl || null,
      ]
    );

    await client.query("COMMIT");
    return launch.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function refreshLaunchByName(name, eventData, launchData) {
  const existing = await findLaunchByName(name);
  if (!existing) return null;

  await database.query(
    `
      UPDATE public.events
      SET start_time = $2,
          end_time = $3,
          date_precision = $4,
          description = $5,
          webcast_live = $6,
          video_url = $7,
          info_url = $8,
          image_url = $9
      WHERE event_id = $1
    `,
    [
      existing.event_id,
      eventData.startTime,
      eventData.endTime || null,
      eventData.datePrecision || null,
      eventData.description || null,
      eventData.webcastLive ?? false,
      eventData.videoUrl || null,
      eventData.infoUrl || null,
      eventData.imageUrl || null,
    ]
  );

  await database.query(
    `
      UPDATE public.rocket_launch
      SET status = $2,
          net_precision = $3,
          image_url = $4,
          cached_at = now()
      WHERE launch_id = $1
    `,
    [
      existing.launch_id,
      launchData.status || null,
      launchData.netPrecision || null,
      launchData.imageUrl || null,
    ]
  );

  return existing;
}

// ---- lookup upserts (all client-aware, SELECT-then-INSERT) ----------------

async function upsertMission(client, mission) {
  if (!mission || !mission.name) return null;
  const found = await client.query(
    "SELECT mission_id FROM public.missions WHERE name = $1 LIMIT 1",
    [mission.name]
  );
  if (found.rows.length > 0) return found.rows[0].mission_id;

  const ins = await client.query(
    "INSERT INTO public.missions (name, mission_type, description) VALUES ($1, $2, $3) RETURNING mission_id",
    [mission.name, mission.missionType || null, mission.description || null]
  );
  return ins.rows[0].mission_id;
}

async function upsertRocket(client, rocket) {
  if (!rocket || !rocket.model) return null;
  const found = await client.query(
    "SELECT rocket_id FROM public.rockets WHERE model = $1 LIMIT 1",
    [rocket.model]
  );
  if (found.rows.length > 0) return found.rows[0].rocket_id;

  const ins = await client.query(
    "INSERT INTO public.rockets (model, manufacture, description) VALUES ($1, $2, $3) RETURNING rocket_id",
    [rocket.model, rocket.manufacturer || null, rocket.description || null]
  );
  return ins.rows[0].rocket_id;
}

async function upsertProvider(client, provider) {
  if (!provider || !provider.name) return null;
  const found = await client.query(
    "SELECT provider_id FROM public.providers WHERE name = $1 LIMIT 1",
    [provider.name]
  );
  if (found.rows.length > 0) return found.rows[0].provider_id;

  const ins = await client.query(
    "INSERT INTO public.providers (name) VALUES ($1) RETURNING provider_id",
    [provider.name]
  );
  return ins.rows[0].provider_id;
}

async function upsertLaunchStatus(client, launchStatus) {
  if (!launchStatus || !launchStatus.status) return null;
  const found = await client.query(
    "SELECT launch_status_id FROM public.launch_statuses WHERE status = $1 LIMIT 1",
    [launchStatus.status]
  );
  if (found.rows.length > 0) return found.rows[0].launch_status_id;

  const ins = await client.query(
    "INSERT INTO public.launch_statuses (status) VALUES ($1) RETURNING launch_status_id",
    [launchStatus.status]
  );
  return ins.rows[0].launch_status_id;
}

// Pads need a location_id; resolve the pad's location (with coords) first.
async function upsertPad(client, pad) {
  if (!pad || !pad.name) return null;

  const locationId = await upsertLocation(client, pad.location);

  // pads is UNIQUE(name, location_id) — match on both so the same pad name at a
  // different site doesn't get reused incorrectly.
  const found = await client.query(
    "SELECT pad_id FROM public.pads WHERE name = $1 AND location_id IS NOT DISTINCT FROM $2 LIMIT 1",
    [pad.name, locationId]
  );
  if (found.rows.length > 0) return found.rows[0].pad_id;

  // pads.location_id is NOT NULL — can't create a pad without a resolved location.
  if (!locationId) return null;

  const ins = await client.query(
    "INSERT INTO public.pads (name, location_id) VALUES ($1, $2) RETURNING pad_id",
    [pad.name, locationId]
  );
  return ins.rows[0].pad_id;
}

// Client-aware location upsert (kept local so the pad/location insert stays
// inside the launch transaction rather than opening a second connection like
// db/queries/locations.js does).
async function upsertLocation(client, location) {
  if (!location) return null;
  const { name = null, lat = null, long = null, country = null } = location;

  if (lat != null && long != null) {
    const found = await client.query(
      `
        SELECT location_id FROM public.locations
        WHERE round(lat::numeric, 5) = round($1::numeric, 5)
          AND round(long::numeric, 5) = round($2::numeric, 5)
        LIMIT 1
      `,
      [lat, long]
    );
    if (found.rows.length > 0) return found.rows[0].location_id;
  } else if (name) {
    const found = await client.query(
      "SELECT location_id FROM public.locations WHERE lower(name) = lower($1) LIMIT 1",
      [name]
    );
    if (found.rows.length > 0) return found.rows[0].location_id;
  } else {
    return null;
  }

  const ins = await client.query(
    "INSERT INTO public.locations (name, lat, long, country) VALUES ($1, $2, $3, $4) RETURNING location_id",
    [name, lat, long, country]
  );
  return ins.rows[0].location_id;
}
