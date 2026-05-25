import { app } from "./app.js";
import { PORT } from "./config/env.js";
import { isDriveConfigured } from "./services/drive.service.js";

app.listen(PORT, () => {
  const BACKEND_URL = (process.env.BACKEND_URL || `http://localhost:${PORT}`).trim().replace(/\/$/, "");
  console.log(`Express backend listening on ${BACKEND_URL}`);
  console.log("--- Backend env ---");
  console.log("  Database: configured (DATABASE_URL set)");
  console.log(`  Port: ${PORT}`);
  console.log(`  Backend URL: ${BACKEND_URL}`);
  // Drive debug — remove once working
  console.log("[Drive Debug] GOOGLE_DRIVE_FOLDER_ID:", process.env.GOOGLE_DRIVE_FOLDER_ID ? "set" : "MISSING");
  console.log("[Drive Debug] GOOGLE_OAUTH_CLIENT_JSON_PATH:", process.env.GOOGLE_OAUTH_CLIENT_JSON_PATH || "MISSING");
  console.log("[Drive Debug] GOOGLE_DRIVE_OAUTH_TOKENS:", process.env.GOOGLE_DRIVE_OAUTH_TOKENS ? "set (length=" + process.env.GOOGLE_DRIVE_OAUTH_TOKENS.length + ")" : "MISSING");
  console.log("[Drive Debug] GOOGLE_SERVICE_ACCOUNT_JSON_PATH:", process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH || "not set");
  console.log(
    isDriveConfigured()
      ? "  Google Drive: configured"
      : "  Google Drive: not configured (optional; set GOOGLE_DRIVE_FOLDER_ID and service account to enable uploads)"
  );
});

