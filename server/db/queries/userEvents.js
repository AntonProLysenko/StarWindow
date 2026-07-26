// Queries for user_events — a user's saved events.
//
// Table:
//   user_events(user_event_id PK bigint, user_id FK NOT NULL, event_id FK NOT NULL
//     -> events(event_id) ON DELETE CASCADE, event_comment, event_rating CHECK 1..5)
//   UNIQUE (user_id, event_id)  -- uq_user_events_user_event
//
// The unique constraint lets saveUserEvent() be idempotent via ON CONFLICT, so a
// double-tap on "Save" can't create duplicate saves for the same user+event.

const database = require("../../config/database");
const levelingQueries = require("./leveling");

let userEventImagesDeleteUrlColumnReady = false;

module.exports = {
  saveUserEvent,
  deleteUserEvent,
  getUserEvent,
  getSavedEventsForUser,
  updateUserEventDetails,
  addUserEventImage,
  deleteUserEventImage,
};

/**
 * Save an event for a user. Idempotent: a repeat save returns the existing row
 * (already_saved = true) instead of erroring or inserting a duplicate.
 * @param {number} userId
 * @param {number|string} eventId
 * @returns {Promise<{user_event_id, user_id, event_id, already_saved: boolean}>}
 */
async function saveUserEvent(userId, eventId) {
  const client = await database.connect();

  try {
    await client.query("BEGIN");

    const inserted = await client.query(
      `
        INSERT INTO public.user_events (user_id, event_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, event_id) DO NOTHING
        RETURNING user_event_id, user_id, event_id
      `,
      [userId, eventId]
    );

    if (inserted.rows.length > 0) {
      const progress = await levelingQueries.awardUserPoints(
        userId,
        "save_event",
        "user_event",
        sourceKeys.save(inserted.rows[0].user_event_id),
        client
      );
      await client.query("COMMIT");
      return { ...inserted.rows[0], already_saved: false, progress };
    }

    // Conflict -> it was already saved; return the existing row so the client can
    // still learn its user_event_id (needed to unsave).
    const existing = await client.query(
      "SELECT user_event_id, user_id, event_id FROM public.user_events WHERE user_id = $1 AND event_id = $2 LIMIT 1",
      [userId, eventId]
    );

    await client.query("COMMIT");
    return { ...existing.rows[0], already_saved: true, progress: null };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Remove a saved event by its user_event_id.
 * @param {number|string} userEventId
 * @returns {Promise<boolean>} true if a row was deleted.
 */
async function deleteUserEvent(userEventId, userId = null) {
  const client = await database.connect();
  let imgbbDeleteUrls = [];

  try {
    await client.query("BEGIN");
    await ensureUserEventImagesDeleteUrlColumn(client);

    const params = userId == null ? [userEventId] : [userEventId, userId];
    const ownershipClause = userId == null ? "" : "AND ue.user_id = $2";
    const existing = await client.query(
      `
        SELECT
          ue.user_event_id,
          ue.user_id,
          ue.event_id,
          ue.event_comment,
          ue.event_rating,
          COUNT(uei.user_event_image_id) AS image_count
        FROM public.user_events ue
        LEFT JOIN public.user_event_images uei ON uei.user_event_id = ue.user_event_id
        WHERE ue.user_event_id = $1
          ${ownershipClause}
        GROUP BY ue.user_event_id, ue.user_id, ue.event_id, ue.event_comment, ue.event_rating
        LIMIT 1
      `,
      params
    );

    if (existing.rows.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }

    const savedEvent = existing.rows[0];
    imgbbDeleteUrls = await getUserEventImageDeleteUrls(savedEvent.user_event_id, client);
    const reversals = await reverseSavedEventMechanics(savedEvent, client);

    const deleted = await client.query(
      `
        DELETE FROM public.user_events
        WHERE user_event_id = $1
          AND user_id = $2
        RETURNING user_event_id
      `,
      [savedEvent.user_event_id, savedEvent.user_id]
    );

    await client.query("COMMIT");
    const imgbbDeletions = await deleteImagesFromImgbb(imgbbDeleteUrls, {
      userId: savedEvent.user_id,
      userEventId: savedEvent.user_event_id,
    });
    return {
      deleted: deleted.rows.length > 0,
      user_event_id: savedEvent.user_event_id,
      reversals,
      imgbb_deletions: imgbbDeletions,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Look up whether a user has saved a given event (used to seed the modal's
 * saved/unsaved state when it opens).
 * @returns {Promise<{user_event_id}|null>}
 */
async function getUserEvent(userId, eventId) {
  const result = await database.query(
    `
      SELECT
        ue.user_event_id,
        ue.event_comment,
        ue.event_rating,
        COALESCE((
          SELECT json_agg(
            json_build_object(
              'user_event_image_id', uei.user_event_image_id,
              'image_url', uei.image_url,
              'caption', uei.caption,
              'created_at', uei.created_at
            )
            ORDER BY uei.created_at DESC, uei.user_event_image_id DESC
          )
          FROM public.user_event_images uei
          WHERE uei.user_event_id = ue.user_event_id
        ), '[]'::json) AS user_event_images
      FROM public.user_events ue
      WHERE ue.user_id = $1
        AND ue.event_id = $2
      LIMIT 1
    `,
    [userId, eventId]
  );
  return result.rows[0] || null;
}

async function updateUserEventDetails(userId, userEventId, data) {
  const client = await database.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `
        SELECT user_event_id, user_id, event_id, event_comment, event_rating
        FROM public.user_events
        WHERE user_event_id = $1
          AND user_id = $2
        LIMIT 1
      `,
      [userEventId, userId]
    );

    if (existing.rows.length === 0) {
      const error = new Error("Saved event not found");
      error.status = 404;
      throw error;
    }

    const previous = existing.rows[0];
    const hasComment = Object.prototype.hasOwnProperty.call(data, "event_comment");
    const hasRating = Object.prototype.hasOwnProperty.call(data, "event_rating");
    const nextComment = hasComment ? normalizeComment(data.event_comment) : previous.event_comment;
    const nextRating = hasRating ? normalizeRating(data.event_rating) : previous.event_rating;

    const updated = await client.query(
      `
        UPDATE public.user_events
        SET event_comment = $3,
            event_rating = $4
        WHERE user_event_id = $1
          AND user_id = $2
        RETURNING user_event_id, user_id, event_id, event_comment, event_rating
      `,
      [userEventId, userId, nextComment, nextRating]
    );

    const awards = [];
    const reversals = [];
    if (hasMeaningfulComment(nextComment) && !hasMeaningfulComment(previous.event_comment)) {
      awards.push(
        await levelingQueries.awardUserPoints(
          userId,
          "comment_event",
          "user_event",
          sourceKeys.comment(userEventId),
          client
        )
      );
    }

    if (!hasMeaningfulComment(nextComment) && hasMeaningfulComment(previous.event_comment)) {
      reversals.push(
        await reverseWithFallback(
          userId,
          "comment_event",
          "user_event",
          [sourceKeys.comment(userEventId), sourceKeys.legacyEvent(previous.event_id)],
          client
        )
      );
    }

    if (nextRating != null && previous.event_rating == null) {
      awards.push(
        await levelingQueries.awardUserPoints(
          userId,
          "rate_event",
          "user_event",
          sourceKeys.rating(userEventId),
          client
        )
      );
    }

    if (nextRating == null && previous.event_rating != null) {
      reversals.push(
        await reverseWithFallback(
          userId,
          "rate_event",
          "user_event",
          [sourceKeys.rating(userEventId), sourceKeys.legacyEvent(previous.event_id)],
          client
        )
      );
    }

    await client.query("COMMIT");
    return { ...updated.rows[0], awards, reversals };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function addUserEventImage(userId, userEventId, data) {
  const imageUrl = String(data?.image_url || data?.imageUrl || "").trim();
  const imgbbDeleteUrl = normalizeImgbbDeleteUrl(data?.imgbb_delete_url || data?.imgbbDeleteUrl);
  const caption = normalizeComment(data?.caption);

  if (!imageUrl) {
    const error = new Error("image_url is required");
    error.status = 400;
    throw error;
  }

  const client = await database.connect();

  try {
    await client.query("BEGIN");
    await ensureUserEventImagesDeleteUrlColumn(client);

    const savedEvent = await client.query(
      `
        SELECT
          ue.user_event_id,
          COUNT(uei.user_event_image_id) AS image_count
        FROM public.user_events ue
        LEFT JOIN public.user_event_images uei ON uei.user_event_id = ue.user_event_id
        WHERE ue.user_event_id = $1
          AND ue.user_id = $2
        GROUP BY ue.user_event_id
        LIMIT 1
      `,
      [userEventId, userId]
    );

    if (savedEvent.rows.length === 0) {
      const error = new Error("Saved event not found");
      error.status = 404;
      throw error;
    }

    const inserted = await client.query(
      `
        INSERT INTO public.user_event_images (user_event_id, image_url, caption, imgbb_delete_url)
        VALUES ($1, $2, $3, $4)
        RETURNING user_event_image_id, user_event_id, image_url, caption, created_at
      `,
      [userEventId, imageUrl, caption, imgbbDeleteUrl]
    );

    const previousImageCount = Number(savedEvent.rows[0].image_count ?? 0);
    const progress =
      previousImageCount === 0
        ? await levelingQueries.awardUserPoints(
            userId,
            "add_saved_event_image",
            "user_event_image",
            sourceKeys.image(userEventId),
            client
          )
        : null;

    await client.query("COMMIT");
    return { ...inserted.rows[0], progress };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function deleteUserEventImage(userId, userEventId, userEventImageId) {
  const client = await database.connect();
  let shouldReverseImagePoints = false;
  let imgbbDeleteUrl = null;

  try {
    await client.query("BEGIN");
    await ensureUserEventImagesDeleteUrlColumn(client);

    const existing = await client.query(
      `
        SELECT
          uei.user_event_image_id,
          uei.imgbb_delete_url,
          ue.user_event_id,
          ue.user_id
        FROM public.user_event_images uei
        JOIN public.user_events ue ON ue.user_event_id = uei.user_event_id
        WHERE uei.user_event_image_id = $1
          AND ue.user_event_id = $2
          AND ue.user_id = $3
        LIMIT 1
      `,
      [userEventImageId, userEventId, userId]
    );

    if (existing.rows.length === 0) {
      const error = new Error("Saved event image not found");
      error.status = 404;
      throw error;
    }

    imgbbDeleteUrl = existing.rows[0].imgbb_delete_url || null;

    await client.query(
      "DELETE FROM public.user_event_images WHERE user_event_image_id = $1",
      [userEventImageId]
    );

    const remaining = await client.query(
      "SELECT COUNT(*) AS image_count FROM public.user_event_images WHERE user_event_id = $1",
      [userEventId]
    );

    shouldReverseImagePoints = Number(remaining.rows[0]?.image_count ?? 0) === 0;

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const progress = shouldReverseImagePoints
    ? await reverseImagePointsAfterDelete(userId, userEventId, userEventImageId)
    : null;
  const imgbbDeleted = await deleteImageFromImgbb(imgbbDeleteUrl, {
    userId,
    userEventId,
    userEventImageId,
  });

  return { deleted: true, user_event_image_id: userEventImageId, progress, imgbb_deleted: imgbbDeleted };
}

/**
 * Return every event saved by a user, normalized to the same shape consumed by
 * the events list UI.
 * @param {number} userId
 * @returns {Promise<Array<object>>}
 */
async function getSavedEventsForUser(userId) {
  const result = await database.query(
    `
      SELECT
        ue.user_event_id,
        ue.event_comment,
        ue.event_rating,
        COALESCE((
          SELECT json_agg(
            json_build_object(
              'user_event_image_id', uei.user_event_image_id,
              'image_url', uei.image_url,
              'caption', uei.caption,
              'created_at', uei.created_at
            )
            ORDER BY uei.created_at DESC, uei.user_event_image_id DESC
          )
          FROM public.user_event_images uei
          WHERE uei.user_event_id = ue.user_event_id
        ), '[]'::json) AS user_event_images,
        COALESCE(rl.launch_id, e.event_id) AS id,
        ue.event_id,
        CASE WHEN rl.launch_id IS NULL THEN 'event' ELSE 'launch' END AS category,
        COALESCE(rl.name, e.name) AS name,
        CASE
          WHEN rl.launch_id IS NULL THEN COALESCE(et.event_type, 'Event')
          ELSE 'Rocket Launch'
        END AS type,
        e.start_time AS date,
        COALESCE(e.date_precision, rl.net_precision) AS date_precision,
        CASE
          WHEN rl.launch_id IS NULL THEN e.description
          ELSE m.description
        END AS description,
        COALESCE(rl.image_url, e.image_url) AS image_url,
        CASE
          WHEN rl.launch_id IS NULL THEN (
            SELECT loc.name
            FROM public.event_location el
            JOIN public.locations loc ON loc.location_id = el.location_id
            WHERE el.event_id = e.event_id
            ORDER BY el.event_location_id ASC
            LIMIT 1
          )
          ELSE COALESCE(pad_loc.name, pad.name)
        END AS location,
        CASE WHEN rl.launch_id IS NULL THEN NULL ELSE pad_loc.lat END AS latitude,
        CASE WHEN rl.launch_id IS NULL THEN NULL ELSE pad_loc.long END AS longitude,
        e.webcast_live,
        e.video_url,
        r.model AS rocket_model,
        p.name AS provider,
        m.name AS mission_name,
        m.mission_type,
        pad.name AS pad_name,
        pad_loc.name AS pad_location,
        COALESCE(ls.status, rl.status) AS launch_status
      FROM public.user_events ue
      JOIN public.events e ON e.event_id = ue.event_id
      LEFT JOIN public.event_types et ON et.event_type_id = e.type_id
      LEFT JOIN public.rocket_launch rl ON rl.event_id = e.event_id
      LEFT JOIN public.missions m ON m.mission_id = rl.mission_id
      LEFT JOIN public.rockets r ON r.rocket_id = rl.rocket_id
      LEFT JOIN public.providers p ON p.provider_id = rl.provider_id
      LEFT JOIN public.launch_statuses ls ON ls.launch_status_id = rl.launch_status_id
      LEFT JOIN public.pads pad ON pad.pad_id = rl.pad_id
      LEFT JOIN public.locations pad_loc ON pad_loc.location_id = pad.location_id
      WHERE ue.user_id = $1
      ORDER BY e.start_time ASC, ue.user_event_id ASC
    `,
    [userId]
  );

  return result.rows.map((row) => ({
    user_event_id: row.user_event_id,
    event_comment: row.event_comment,
    event_rating: row.event_rating,
    user_event_images: row.user_event_images || [],
    id: row.id,
    event_id: row.event_id,
    category: row.category,
    name: row.name,
    type: row.type,
    date: row.date,
    date_precision: row.date_precision,
    description: row.description,
    image_url: row.image_url,
    location: row.location,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    webcast_live: row.webcast_live ?? false,
    video_url: row.video_url || null,
    launch_details:
      row.category === "launch"
        ? {
            rocket_model: row.rocket_model || null,
            provider: row.provider || null,
            mission_name: row.mission_name || null,
            mission_type: row.mission_type || null,
            pad_name: row.pad_name || null,
            pad_location: row.pad_location || null,
            status: row.launch_status || null,
          }
        : null,
  }));
}

function normalizeComment(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeRating(value) {
  if (value == null || value === "") return null;
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    const error = new Error("event_rating must be an integer from 1 to 5");
    error.status = 400;
    throw error;
  }
  return rating;
}

function hasMeaningfulComment(value) {
  return String(value || "").trim().length >= 3;
}

async function ensureUserEventImagesDeleteUrlColumn(client) {
  if (userEventImagesDeleteUrlColumnReady) return;
  await client.query(
    "ALTER TABLE public.user_event_images ADD COLUMN IF NOT EXISTS imgbb_delete_url text"
  );
  userEventImagesDeleteUrlColumnReady = true;
}

function normalizeImgbbDeleteUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.hostname !== "ibb.co") return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function getUserEventImageDeleteUrls(userEventId, client) {
  const result = await client.query(
    `
      SELECT imgbb_delete_url
      FROM public.user_event_images
      WHERE user_event_id = $1
        AND imgbb_delete_url IS NOT NULL
    `,
    [userEventId]
  );

  return result.rows.map((row) => row.imgbb_delete_url).filter(Boolean);
}

async function deleteImagesFromImgbb(deleteUrls, context = {}) {
  const results = await Promise.all(
    deleteUrls.map((deleteUrl) => deleteImageFromImgbb(deleteUrl, context))
  );

  return {
    attempted: deleteUrls.length,
    deleted: results.filter((result) => result === true).length,
    skipped: results.filter((result) => result === null).length,
    failed: results.filter((result) => result === false).length,
  };
}

async function deleteImageFromImgbb(deleteUrl, context = {}) {
  const normalizedDeleteUrl = normalizeImgbbDeleteUrl(deleteUrl);
  if (!normalizedDeleteUrl) return null;

  try {
    const response = await fetch(normalizedDeleteUrl, { method: "GET" });
    if (response.ok) return true;

    console.warn("ImgBB image delete failed:", {
      ...context,
      status: response.status,
      statusText: response.statusText,
    });
    return false;
  } catch (error) {
    console.warn("ImgBB image delete failed:", {
      ...context,
      error: error.message,
    });
    return false;
  }
}

const sourceKeys = {
  save: (userEventId) => `user_event:${userEventId}:save`,
  comment: (userEventId) => `user_event:${userEventId}:comment`,
  rating: (userEventId) => `user_event:${userEventId}:rating`,
  image: (userEventId) => `user_event:${userEventId}:image`,
  legacyEvent: (eventId) => `event:${eventId}`,
  legacyImage: (userEventId) => `user_event:${userEventId}:first_image`,
};

async function reverseSavedEventMechanics(savedEvent, client) {
  const userId = savedEvent.user_id;
  const userEventId = savedEvent.user_event_id;
  const eventId = savedEvent.event_id;
  const reversals = [];

  if (Number(savedEvent.image_count ?? 0) > 0) {
    reversals.push(
      await reverseWithFallback(
        userId,
        "add_saved_event_image",
        "user_event_image",
        [sourceKeys.image(userEventId), sourceKeys.legacyImage(userEventId)],
        client
      )
    );
  }

  if (savedEvent.event_rating != null) {
    reversals.push(
      await reverseWithFallback(
        userId,
        "rate_event",
        "user_event",
        [sourceKeys.rating(userEventId), sourceKeys.legacyEvent(eventId)],
        client
      )
    );
  }

  if (hasMeaningfulComment(savedEvent.event_comment)) {
    reversals.push(
      await reverseWithFallback(
        userId,
        "comment_event",
        "user_event",
        [sourceKeys.comment(userEventId), sourceKeys.legacyEvent(eventId)],
        client
      )
    );
  }

  reversals.push(
    await reverseWithFallback(
      userId,
      "save_event",
      "user_event",
      [sourceKeys.save(userEventId), sourceKeys.legacyEvent(eventId)],
      client
    )
  );

  return reversals.filter(Boolean);
}

async function reverseWithFallback(userId, actionCode, sourceType, possibleSourceKeys, client) {
  let lastResult = null;

  for (const sourceKey of possibleSourceKeys) {
    const result = await levelingQueries.reverseUserPoints(
      userId,
      actionCode,
      sourceType,
      sourceKey,
      client
    );
    lastResult = result;
    if (result.reversed) return result;
  }

  return lastResult;
}

async function reverseImagePointsAfterDelete(userId, userEventId, userEventImageId) {
  const client = await database.connect();

  try {
    await client.query("BEGIN");
    const progress = await reverseWithFallback(
      userId,
      "add_saved_event_image",
      "user_event_image",
      [sourceKeys.image(userEventId), sourceKeys.legacyImage(userEventId)],
      client
    );
    await client.query("COMMIT");
    return progress;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.warn("Saved event image deleted, but image point reversal failed:", {
      userId,
      userEventId,
      userEventImageId,
      error: error.message,
    });
    return null;
  } finally {
    client.release();
  }
}
