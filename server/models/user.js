const bcrypt = require("bcryptjs");

const database = require("../config/database");
const SALT_ROUNDS = 12;

// A throwaway hash used to run a bcrypt comparison when a login email doesn't
// exist, so response timing doesn't reveal whether an account is registered.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("not-a-real-password", SALT_ROUNDS);

module.exports = {
  create,
  findOne,
  findById,
  updateProfile,
  verifyPassword,
};


async function create(userData) {
  const email = userData.email.toLowerCase().trim();
  const f_name = userData.f_name.trim();
  const l_name = userData.l_name.trim();
  const password = userData.password.trim();

  // Never trust status_id from the request body — a new user always starts at the
  // base tier (lowest min_points). The leveling system promotes them from there
  // as they earn points (see db/queries/leveling.js syncUserLevel).
  const status_id = await getBaseStatusId();

  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

  let result;
  try {
    result = await database.query(
      `
        INSERT INTO public.users (email, f_name, l_name, password, status_id)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING user_id
      `,
      [email, f_name, l_name, hashedPassword, status_id]
    );
  } catch (err) {
    // 23505 = unique_violation (email already registered). Surface a friendly
    // client error instead of a raw Postgres error.
    if (err.code === "23505") {
      const conflict = new Error("That email is already registered.");
      conflict.status = 409;
      throw conflict;
    }
    throw err;
  }

  return findById(result.rows[0]?.user_id);
}

async function findOne(req) {
  const email = String(req?.email ?? "").trim().toLowerCase();
  if (!email) return null;

  const result = await database.query(
    `
      SELECT
        u.user_id,
        u.email,
        u.f_name,
        u.l_name,
        u.password,
        u.status_id,
        us.status,
        us.min_points
      FROM public.users u
      JOIN public.user_statuses us ON us.status_id = u.status_id
      WHERE lower(trim(u.email)) = $1
      LIMIT 1
    `, [email]);

  return result.rows[0] || null;
}

async function findById(userId) {
  const result = await database.query(
    `
      SELECT
        u.user_id,
        u.email,
        u.f_name,
        u.l_name,
        u.status_id,
        us.status,
        us.min_points
      FROM public.users u
      JOIN public.user_statuses us ON us.status_id = u.status_id
      WHERE u.user_id = $1
      LIMIT 1
    `,
    [userId]
  );

  return result.rows[0] || null;
}

async function updateProfile(userId, userData) {
  const email = String(userData.email || "").toLowerCase().trim();
  const f_name = String(userData.f_name || "").trim();
  const l_name = String(userData.l_name || "").trim();

  if (!f_name || !l_name || !email) {
    const error = new Error("First name, last name, and email are required.");
    error.status = 400;
    throw error;
  }

  const duplicate = await database.query(
    `
      SELECT user_id
      FROM public.users
      WHERE lower(trim(email)) = $1
        AND user_id <> $2
      LIMIT 1
    `,
    [email, userId]
  );

  if (duplicate.rows.length > 0) {
    const error = new Error("Email is already in use.");
    error.status = 409;
    throw error;
  }

  const result = await database.query(
    `
      UPDATE public.users
      SET email = $2,
          f_name = $3,
          l_name = $4
      WHERE user_id = $1
      RETURNING user_id
    `,
    [userId, email, f_name, l_name]
  );

  if (result.rows.length === 0) return null;
  return findById(userId);
}

// Verify a login password against the stored hash. On success, transparently
// re-hash at the current SALT_ROUNDS if the stored hash is weaker (e.g. legacy
// cost-6 hashes) so active users are upgraded without a password reset. A failed
// re-hash write must never reject an otherwise-valid login.
async function verifyPassword(user, plainPassword) {
  const password = String(plainPassword ?? "");
  // Always run a bcrypt compare — against a dummy hash when the user doesn't
  // exist — so timing is the same whether or not the email is registered.
  const hash = user?.password || DUMMY_PASSWORD_HASH;
  const match = await bcrypt.compare(password, hash);
  if (!user || !match) return false;

  if (needsRehash(user.password)) {
    try {
      const newHash = await bcrypt.hash(password, SALT_ROUNDS);
      await updatePassword(user.user_id, newHash);
    } catch (err) {
      console.error("Password re-hash on login failed:", err);
    }
  }

  return true;
}

// True when the stored hash's cost is below the current target (or unreadable —
// getRounds returns NaN for a malformed hash).
function needsRehash(hash) {
  const rounds = bcrypt.getRounds(hash);
  return Number.isNaN(rounds) || rounds < SALT_ROUNDS;
}

async function updatePassword(userId, hashedPassword) {
  await database.query(
    `
      UPDATE public.users
      SET password = $2
      WHERE user_id = $1
    `,
    [userId, hashedPassword]
  );
}

// Resolve the base user status (lowest min_points) — the tier every new signup
// starts at. Mirrors the base-tier ordering in db/queries/leveling.js.
async function getBaseStatusId() {
  const result = await database.query(
    `
      SELECT status_id
      FROM public.user_statuses
      ORDER BY min_points ASC, status_id ASC
      LIMIT 1
    `
  );

  const statusId = result.rows[0]?.status_id;
  if (statusId == null) {
    throw new Error("No user statuses are configured.");
  }
  return statusId;
}
