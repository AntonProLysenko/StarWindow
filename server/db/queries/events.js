// Queries for events and their link tables.
//
// Tables touched:
//   events(event_id PK, name, start_time, end_time, date_precision, description,
//     type_id FK, webcast_live, video_url, image_url)
//   event_types(event_type_id PK, event_type)
//   event_location(event_location_id PK, event_id FK, location_id FK)
//   event_bodies(event_body_id PK, event_id FK, body_id FK)
//
// Each write function takes an OPTIONAL `client` as its last argument. When a
// caller passes its own pg client (e.g. the launch transaction), these run on
// that client so everything commits atomically; otherwise they run on the pool.

const database = require("../../config/database");

module.exports = {
  getCachedEvents,
  getLatestCachedAt,
  getUpcomingNonLaunchEvents,
  getNonLaunchEventsInWindow,
  saveEvent,
  findEventByNaturalKey,
  upsertEventType,
  insertEvent,
  linkEventToLocation,
  linkEventToBody,
};

/**
 * Return cached events joined with their type name, soonest first.
 * @param {object|number} [opts]
 * @param {number} [opts.limit]
 * @param {string} [opts.fromDate] - inclusive YYYY-MM-DD/ISO lower bound
 * @param {string} [opts.toDate] - inclusive YYYY-MM-DD/ISO upper bound
 */
async function getCachedEvents(opts) {
  const { limit, fromDate, toDate } =
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

  let limitClause = "";
  if (Number.isFinite(limit) && limit > 0) {
    values.push(limit);
    limitClause = `LIMIT $${values.length}`;
  }

  const result = await database.query(
    `
      SELECT
        e.event_id, e.name, e.start_time, e.end_time, e.date_precision,
        e.description, e.type_id, et.event_type, e.webcast_live,
        e.video_url, e.image_url, e.updated_at
      FROM public.events e
      LEFT JOIN public.event_types et ON et.event_type_id = e.type_id
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY e.start_time ASC, e.event_id ASC
      ${limitClause}
    `,
    values
  );
  return result.rows;
}

async function getLatestCachedAt(opts = {}) {
  const { fromDate, toDate } = opts || {};
  const values = [];
  const where = [];

  if (fromDate) {
    values.push(fromDate);
    where.push(`start_time >= $${values.length}::timestamptz`);
  }

  if (toDate) {
    values.push(toDate);
    where.push(`start_time < ($${values.length}::date + INTERVAL '1 day')`);
  }

  const result = await database.query(
    `
      SELECT MAX(updated_at) AS latest
      FROM public.events
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    `,
    values
  );
  return result.rows[0]?.latest || null;
}

/**
 * Return UPCOMING space events that are NOT rocket launches, soonest first.
 *
 * A launch is stored as an events row plus a rocket_launch row pointing at it
 * (rocket_launch.event_id is a UNIQUE FK), so those base event rows must be
 * excluded here — they're returned separately via launches.getUpcomingLaunches()
 * with their launch-specific fields. The NOT EXISTS clause does that filtering.
 *
 * The location name is pulled with a correlated subquery (rather than a JOIN on
 * event_location) so an event linked to more than one location still yields
 * exactly one row instead of multiplying.
 *
 * @param {number} [limit=200]
 */
async function getUpcomingNonLaunchEvents(limit = 200) {
  const result = await database.query(
    `
      SELECT * FROM (
        SELECT DISTINCT ON (e.name, e.start_time)
          e.event_id, e.name, e.start_time, e.date_precision, e.description,
          e.image_url, e.webcast_live, e.video_url, et.event_type,
          (
            SELECT loc.name
            FROM public.event_location el
            JOIN public.locations loc ON loc.location_id = el.location_id
            WHERE el.event_id = e.event_id
            ORDER BY el.event_location_id ASC
            LIMIT 1
          ) AS location_name
        FROM public.events e
        LEFT JOIN public.event_types et ON et.event_type_id = e.type_id
        WHERE e.start_time >= now()
          AND NOT EXISTS (
            SELECT 1 FROM public.rocket_launch rl WHERE rl.event_id = e.event_id
          )
        -- DISTINCT ON keeps ONE row per (name, start_time), collapsing duplicate
        -- rows the event ingest may have inserted; keep the lowest event_id.
        ORDER BY e.name, e.start_time, e.event_id
      ) uniq
      ORDER BY uniq.start_time ASC
      LIMIT $1
    `,
    [limit]
  );
  return result.rows;
}

async function getNonLaunchEventsInWindow({ limit = 200, fromDate, toDate } = {}) {
  const values = [];
  const where = [
    `NOT EXISTS (
      SELECT 1 FROM public.rocket_launch rl WHERE rl.event_id = e.event_id
    )`,
  ];

  if (fromDate) {
    values.push(fromDate);
    where.push(`e.start_time >= $${values.length}::timestamptz`);
  }

  if (toDate) {
    values.push(toDate);
    where.push(`e.start_time <= $${values.length}::timestamptz`);
  }

  values.push(limit);
  const result = await database.query(
    `
      SELECT * FROM (
        SELECT DISTINCT ON (e.name, e.start_time)
          e.event_id, e.name, e.start_time, e.date_precision, e.description,
          e.image_url, e.webcast_live, e.video_url, et.event_type,
          (
            SELECT loc.name
            FROM public.event_location el
            JOIN public.locations loc ON loc.location_id = el.location_id
            WHERE el.event_id = e.event_id
            ORDER BY el.event_location_id ASC
            LIMIT 1
          ) AS location_name
        FROM public.events e
        LEFT JOIN public.event_types et ON et.event_type_id = e.type_id
        WHERE ${where.join(" AND ")}
        ORDER BY e.name, e.start_time, e.event_id
      ) uniq
      ORDER BY uniq.start_time ASC
      LIMIT $${values.length}
    `,
    values
  );
  return result.rows;
}

/**
 * Existence check used by the event service to avoid inserting duplicate events.
 * LL2 /events/ has no stable id stored here, so (name, start_time) is the natural
 * key — the same eclipse/flyby fetched repeatedly shares both. Mirrors the launch
 * service's findLaunchByName() dedup guard.
 * @param {string} name
 * @param {string} startTime
 * @returns {Promise<object|null>} the existing row's event_id, or null.
 */
async function findEventByNameAndTime(name, startTime) {
  const result = await database.query(
    "SELECT event_id FROM public.events WHERE name = $1 AND start_time = $2 LIMIT 1",
    [name, startTime]
  );
  return result.rows[0] || null;
}

/**
 * Upsert a non-launch space event and its links in one transaction.
 * @param {object} data
 * @param {string} data.name
 * @param {string} data.startTime
 * @param {string} [data.endTime]
 * @param {string} [data.datePrecision]
 * @param {string} [data.description]
 * @param {string} [data.eventType] - type name; upserted into event_types.
 * @param {boolean} [data.webcastLive]
 * @param {string} [data.videoUrl]
 * @param {string} [data.imageUrl]
 * @param {number} [data.locationId] - if set, linked via event_location.
 * @param {number[]} [data.bodyIds] - if set, each linked via event_bodies.
 * @returns {Promise<object>} the inserted events row.
 */
async function saveEvent(data) {
  const client = await database.connect();
  try {
    await client.query("BEGIN");

    const typeId = data.eventType ? await upsertEventType(data.eventType, client) : null;
    const existing = await findEventByNaturalKey(
      {
        name: data.name,
        startTime: data.startTime,
        typeId,
      },
      client
    );

    if (existing) {
      await updateEvent(existing.event_id, data, typeId, client);

      if (data.locationId) {
        await linkEventToLocation(existing.event_id, data.locationId, client);
      }
      for (const bodyId of data.bodyIds || []) {
        await linkEventToBody(existing.event_id, bodyId, client);
      }

      await client.query("COMMIT");
      return existing;
    }

    const event = await insertEvent({ ...data, typeId }, client);

    if (data.locationId) {
      await linkEventToLocation(event.event_id, data.locationId, client);
    }
    for (const bodyId of data.bodyIds || []) {
      await linkEventToBody(event.event_id, bodyId, client);
    }

    await client.query("COMMIT");
    return event;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function findEventByNaturalKey({ name, startTime, typeId }, client) {
  const db = client || database;
  if (!name || !startTime) return null;

  const result = await db.query(
    `
      SELECT event_id, name, start_time, end_time, date_precision, description,
             type_id, webcast_live, video_url, image_url, updated_at
      FROM public.events
      WHERE lower(name) = lower($1)
        AND start_time = $2::timestamptz
        AND type_id IS NOT DISTINCT FROM $3
      LIMIT 1
    `,
    [name, startTime, typeId || null]
  );
  return result.rows[0] || null;
}

async function updateEvent(eventId, data, typeId, client) {
  const db = client || database;
  const result = await db.query(
    `
      UPDATE public.events
      SET name = $2,
          start_time = $3,
          end_time = $4,
          date_precision = $5,
          description = $6,
          type_id = $7,
          webcast_live = $8,
          video_url = $9,
          image_url = $10,
          updated_at = now()
      WHERE event_id = $1
      RETURNING event_id, name, start_time, end_time, date_precision, description,
                type_id, webcast_live, video_url, image_url, updated_at
    `,
    [
      eventId,
      data.name,
      data.startTime,
      data.endTime || null,
      data.datePrecision || null,
      data.description || null,
      typeId || null,
      data.webcastLive ?? false,
      data.videoUrl || null,
      data.imageUrl || null,
    ]
  );
  return result.rows[0];
}

/** Resolve (or create) an event_types row by name; returns event_type_id. */
async function upsertEventType(typeName, client) {
  const db = client || database;
  if (!typeName) return null;

  const found = await db.query(
    "SELECT event_type_id FROM public.event_types WHERE event_type = $1 LIMIT 1",
    [typeName]
  );
  if (found.rows.length > 0) return found.rows[0].event_type_id;

  const ins = await db.query(
    "INSERT INTO public.event_types (event_type) VALUES ($1) RETURNING event_type_id",
    [typeName]
  );
  return ins.rows[0].event_type_id;
}

/** Insert one events row; returns the full row (incl. event_id). */
async function insertEvent(data, client) {
  const db = client || database;
  const result = await db.query(
    `
      INSERT INTO public.events
        (name, start_time, end_time, date_precision, description, type_id,
         webcast_live, video_url, image_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING event_id, name, start_time, end_time, date_precision, description,
                type_id, webcast_live, video_url, image_url, updated_at
    `,
    [
      data.name,
      data.startTime,
      data.endTime || null,
      data.datePrecision || null,
      data.description || null,
      data.typeId || null,
      data.webcastLive ?? false, // events.webcast_live is NOT NULL DEFAULT false
      data.videoUrl || null,
      data.imageUrl || null,
    ]
  );
  return result.rows[0];
}

async function linkEventToLocation(eventId, locationId, client) {
  const db = client || database;
  await db.query(
    `
      INSERT INTO public.event_location (event_id, location_id)
      VALUES ($1, $2)
      ON CONFLICT (event_id, location_id) DO NOTHING
    `,
    [eventId, locationId]
  );
}

async function linkEventToBody(eventId, bodyId, client) {
  const db = client || database;
  await db.query(
    `
      INSERT INTO public.event_bodies (event_id, body_id)
      VALUES ($1, $2)
      ON CONFLICT (event_id, body_id) DO NOTHING
    `,
    [eventId, bodyId]
  );
}
