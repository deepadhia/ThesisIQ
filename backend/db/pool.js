import pkg from "pg";
import { DATABASE_URL } from "../config/env.js";

const { Pool } = pkg;

// Manually parse to absolutely guarantee the project-ref isn't dropped by pg or environment overrides
let parsedUrl;
try {
  parsedUrl = new URL(DATABASE_URL);
} catch (e) {
  console.error("Invalid DATABASE_URL format:", e.message);
  parsedUrl = { username: "", password: "", hostname: "", port: "5432", pathname: "/postgres" };
}

console.log("[DB DEBUG] user:", parsedUrl.username);
console.log("[DB DEBUG] host:", parsedUrl.hostname);
console.log("[DB DEBUG] port:", parsedUrl.port);
console.log("[DB DEBUG] db:", parsedUrl.pathname);

export const pool = new Pool({
  user: parsedUrl.username,
  password: decodeURIComponent(parsedUrl.password),
  host: parsedUrl.hostname,
  port: parseInt(parsedUrl.port, 10) || 5432,
  database: parsedUrl.pathname.replace("/", ""),
  ssl: { rejectUnauthorized: false },
});

// Run database maintenance to clean up any mismatched/duplicated filing links
pool.query(`
  DELETE FROM filing_drive_links
  WHERE filename LIKE '%_raw_xbrl_%'
    AND split_part(filename, '_', 2) != quarter
`).then((res) => {
  if (res.rowCount > 0) {
    console.log(`[DB MAINTENANCE] Cleaned up ${res.rowCount} mismatched XBRL filing links.`);
  }
}).catch((err) => {
  console.error("[DB MAINTENANCE] Failed to clean up mismatched filing links:", err.message);
});


