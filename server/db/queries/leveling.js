const database = require("../../config/database");

module.exports = {
  awardUserPoints,
  reverseUserPoints,
  getUserLevelSummary,
  getUserPointHistory,
};

function db(client) {
  return client || database;
}

async function awardUserPoints(userId, actionCode, sourceType, sourceKey, client) {
  const conn = db(client);

  const actionPoints = await getPointScore(conn, actionCode);

  await ensureUserProgress(conn, userId);

  const balance = await getSourceBalance(conn, userId, actionCode, sourceKey);
  if (balance.netPoints > 0) {
    return buildProgressResponse(conn, userId, {
      awarded: false,
      reversed: false,
      pointsDelta: 0,
    });
  }

  const historySourceKey =
    balance.entryCount === 0 ? sourceKey : buildHistorySourceKey(sourceKey, "award", balance.entryCount);

  const inserted = await conn.query(
    `
      INSERT INTO public.user_point_event_history (
        user_id,
        action_code,
        points,
        source_type,
        source_key
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, action_code, source_key) DO NOTHING
      RETURNING points
    `,
    [userId, actionCode, actionPoints, sourceType, historySourceKey]
  );

  const pointsAwarded = Number(inserted.rows[0]?.points ?? 0);

  return buildProgressResponse(conn, userId, {
    awarded: pointsAwarded > 0,
    reversed: false,
    pointsDelta: pointsAwarded,
  });
}

async function reverseUserPoints(userId, actionCode, sourceType, sourceKey, client) {
  const conn = db(client);
  const actionPoints = await getPointScore(conn, actionCode);

  await ensureUserProgress(conn, userId);

  const balance = await getSourceBalance(conn, userId, actionCode, sourceKey);
  if (balance.netPoints <= 0) {
    return buildProgressResponse(conn, userId, {
      awarded: false,
      reversed: false,
      pointsDelta: 0,
    });
  }

  const pointsToReverse = Math.min(Math.abs(actionPoints), balance.netPoints);
  const deleted = await conn.query(
    `
      WITH ranked_awards AS (
        SELECT
          user_point_event_history_id,
          points,
          SUM(points) OVER (
            ORDER BY created_at DESC, user_point_event_history_id DESC
          ) AS running_points
        FROM public.user_point_event_history
        WHERE user_id = $1
          AND action_code = $2
          AND points > 0
          AND (
            source_key = $3
            OR LEFT(source_key, LENGTH($4)) = $4
          )
      ),
      awards_to_remove AS (
        SELECT user_point_event_history_id
        FROM ranked_awards
        WHERE running_points - points < $5
      )
      DELETE FROM public.user_point_event_history h
      USING awards_to_remove r
      WHERE h.user_point_event_history_id = r.user_point_event_history_id
      RETURNING h.points
    `,
    [userId, actionCode, sourceKey, `${sourceKey}:`, pointsToReverse]
  );

  const pointsReversed = deleted.rows.reduce((sum, row) => sum + Number(row.points ?? 0), 0);

  return buildProgressResponse(conn, userId, {
    awarded: false,
    reversed: pointsReversed > 0,
    pointsDelta: -pointsReversed,
  });
}

async function getPointScore(conn, actionCode) {
  const action = await conn.query(
    `
      SELECT points
      FROM public.point_scores
      WHERE action_code = $1
        AND enabled = true
      LIMIT 1
    `,
    [actionCode]
  );

  if (action.rows.length === 0) {
    const error = new Error(`Unknown or disabled point score: ${actionCode}`);
    error.status = 400;
    throw error;
  }

  return Number(action.rows[0].points);
}

async function ensureUserProgress(conn, userId) {
  await conn.query(
    `
      INSERT INTO public.user_progress (user_id)
      VALUES ($1)
      ON CONFLICT (user_id) DO NOTHING
    `,
    [userId]
  );
}

async function getSourceBalance(conn, userId, actionCode, sourceKey) {
  const result = await conn.query(
    `
      SELECT
        COALESCE(SUM(points), 0) AS net_points,
        COUNT(*) AS entry_count
      FROM public.user_point_event_history
      WHERE user_id = $1
        AND action_code = $2
        AND (
          source_key = $3
          OR LEFT(source_key, LENGTH($4)) = $4
        )
    `,
    [userId, actionCode, sourceKey, `${sourceKey}:`]
  );

  return {
    netPoints: Number(result.rows[0]?.net_points ?? 0),
    entryCount: Number(result.rows[0]?.entry_count ?? 0),
  };
}

function buildHistorySourceKey(sourceKey, direction, entryCount) {
  return `${sourceKey}:${direction}:${entryCount + 1}`;
}

async function buildProgressResponse(conn, userId, { awarded, reversed, pointsDelta }) {
  let totalPoints;

  if (pointsDelta !== 0) {
    const progress = await conn.query(
      `
        UPDATE public.user_progress
        SET total_points = GREATEST(total_points + $2, 0),
            updated_at = now()
        WHERE user_id = $1
        RETURNING total_points
      `,
      [userId, pointsDelta]
    );
    totalPoints = Number(progress.rows[0].total_points);
  } else {
    const progress = await conn.query(
      "SELECT total_points FROM public.user_progress WHERE user_id = $1 LIMIT 1",
      [userId]
    );
    totalPoints = Number(progress.rows[0]?.total_points ?? 0);
  }

  const level = await syncUserLevel(conn, userId, totalPoints);

  return {
    awarded,
    reversed,
    points_awarded: pointsDelta > 0 ? pointsDelta : 0,
    points_reversed: pointsDelta < 0 ? pointsDelta : 0,
    total_points: totalPoints,
    status_id: level.status_id,
    status: level.status,
    next_level_points: level.next_level_points,
    points_to_next_level:
      level.next_level_points == null
        ? 0
        : Math.max(Number(level.next_level_points) - Number(totalPoints), 0),
  };
}

async function syncUserLevel(conn, userId, totalPoints) {
  const level = await conn.query(
    `
      SELECT
        current_level.status_id,
        current_level.status,
        next_level.min_points AS next_level_points
      FROM (
        SELECT status_id, status, min_points
        FROM public.user_statuses
        WHERE min_points <= $1
        ORDER BY min_points DESC, status_id DESC
        LIMIT 1
      ) current_level
      LEFT JOIN LATERAL (
        SELECT min_points
        FROM public.user_statuses
        WHERE min_points > current_level.min_points
        ORDER BY min_points ASC, status_id ASC
        LIMIT 1
      ) next_level ON true
    `,
    [totalPoints]
  );

  if (level.rows.length > 0) {
    await conn.query(
      `
        UPDATE public.users
        SET status_id = $2
        WHERE user_id = $1
          AND status_id IS DISTINCT FROM $2
      `,
      [userId, level.rows[0].status_id]
    );
  }

  return {
    status_id: level.rows[0]?.status_id ?? null,
    status: level.rows[0]?.status ?? null,
    next_level_points: level.rows[0]?.next_level_points ?? null,
  };
}

async function getUserLevelSummary(userId) {
  const result = await database.query(
    `
      SELECT
        user_id,
        status_id,
        status,
        total_points,
        current_level_points,
        next_level_points,
        points_into_level,
        points_to_next_level,
        updated_at
      FROM public.user_level_summary
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId]
  );

  return result.rows[0] || null;
}

async function getUserPointHistory(userId, limit = 25) {
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const result = await database.query(
    `
      SELECT
        h.user_point_event_history_id,
        h.user_id,
        h.action_code,
        ps.display_name,
        h.points,
        h.source_type,
        h.source_key,
        h.created_at
      FROM public.user_point_event_history h
      JOIN public.point_scores ps ON ps.action_code = h.action_code
      WHERE h.user_id = $1
      ORDER BY h.created_at DESC, h.user_point_event_history_id DESC
      LIMIT $2
    `,
    [userId, safeLimit]
  );

  return result.rows;
}
