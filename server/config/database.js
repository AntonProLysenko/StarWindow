const { Pool } = require("pg");
const path = require("path");
const fs = require("fs");

const envPath = path.join(__dirname, "..", ".env");
require("dotenv").config({ path: envPath });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(`DATABASE_URL is not set. Expected it in ${envPath}`);
}

// TLS config for the Postgres connection.
//   - Non-Supabase hosts: no SSL.
//   - Supabase: verify the server certificate when a CA cert is supplied via
//     DB_SSL_CA (PEM contents) or DB_SSL_CA_PATH (file path) — download it from
//     Supabase: Project Settings -> Database -> SSL configuration. Without a CA,
//     Supabase's chain is self-signed and Node can't verify it against its
//     built-in roots, so we fall back to an encrypted-but-unverified connection
//     and warn (set a CA to close this).
function buildSslConfig(cs) {
  if (!cs.includes("supabase")) return false;

  const ca =
    process.env.DB_SSL_CA ||
    (process.env.DB_SSL_CA_PATH
      ? fs.readFileSync(process.env.DB_SSL_CA_PATH, "utf8")
      : null);

  if (ca) return { ca, rejectUnauthorized: true };

  console.warn(
    "[db] TLS certificate verification is DISABLED (no DB_SSL_CA / DB_SSL_CA_PATH set). " +
      "Provide the Supabase CA cert to enable full verification."
  );
  return { rejectUnauthorized: false };
}

const database = new Pool({
  connectionString,
  ssl: buildSslConfig(connectionString),
});

// Idle clients can be terminated by the server (Supabase drops idle
// connections). Without this listener, that 'error' event becomes an
// uncaught exception and crashes the process a few seconds after startup.
database.on("error", (err) => {
  console.error("Unexpected error on idle PostgreSQL client:", err.message);
});



async function testConnection() {
  try {
    const result = await database.query("SELECT NOW()");
    console.log("Connected to PostgreSQL at:", result.rows[0].now);
  } catch (error) {
    console.error("PostgreSQL connection failed:", error.message);
  }
}

testConnection();

module.exports = database;
