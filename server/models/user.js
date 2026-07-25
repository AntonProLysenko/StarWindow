const bcrypt = require("bcryptjs");

const database = require("../config/database");
const SALT_ROUNDS = 6;
const PASSWORD_REQUIREMENTS_MESSAGE =
  "Password must be at least 8 characters and include one uppercase letter, one number, and one special symbol.";

module.exports = {
  create,
  findOne,
  findById,
  updateProfile,
};


async function create(userData) {
  const email = userData.email.toLowerCase().trim();
  const f_name = userData.f_name.trim();
  const l_name = userData.l_name.trim();
  const password = userData.password.trim();
  const status_id = userData.status_id;

  validatePassword(password);

  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

  const result = await database.query(
    `
      INSERT INTO public.users (email, f_name, l_name, password, status_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING user_id
    `,
    [email, f_name, l_name, hashedPassword, status_id]
  );

  return findById(result.rows[0]?.user_id);
}

async function findOne(req) {
  const email = req.email.trim().toLowerCase();

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
  const currentPassword = String(userData.current_password || "").trim();
  const newPassword = String(userData.new_password || "").trim();
  const confirmNewPassword = String(userData.confirm_new_password || "").trim();

  if (!f_name || !l_name || !email) {
    throw new Error("First name, last name, and email are required.");
  }

  if (!currentPassword) {
    throw new Error("Current password is required.");
  }

  if (newPassword || confirmNewPassword) {
    validatePassword(newPassword);

    if (newPassword !== confirmNewPassword) {
      throw new Error("Passwords do not match.");
    }
  }

  const existingUser = await database.query(
    "SELECT user_id, password FROM public.users WHERE user_id = $1 LIMIT 1",
    [userId]
  );

  if (existingUser.rows.length === 0) {
    return null;
  }

  const passwordMatches = await bcrypt.compare(currentPassword, existingUser.rows[0].password);
  if (!passwordMatches) {
    throw new Error("Current password is incorrect.");
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
    throw new Error("Email is already in use.");
  }

  const passwordHash = newPassword ? await bcrypt.hash(newPassword, SALT_ROUNDS) : null;
  const result = passwordHash
    ? await database.query(
        `
          UPDATE public.users
          SET email = $2,
              f_name = $3,
              l_name = $4,
              password = $5
          WHERE user_id = $1
          RETURNING user_id
        `,
        [userId, email, f_name, l_name, passwordHash]
      )
    : await database.query(
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

function validatePassword(password) {
  if (
    password.length < 8 ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    throw new Error(PASSWORD_REQUIREMENTS_MESSAGE);
  }
}
