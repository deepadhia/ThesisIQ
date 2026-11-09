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
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.warn('[DB POOL NOTICE] Idle client connection reset/dropped:', err.message);
});

// Importing the pool must be side-effect free: even audits and dry-run repair scripts import it.
// Data cleanup belongs in an explicitly invoked, backed-up maintenance operation.


