import axios from "axios";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("JWT_SECRET is missing from .env.local!");
  process.exit(1);
}

async function triggerBulkSync() {
  console.log("=========================================");
  console.log("TRIGGERING BULK SYSTEM-WIDE SUPER SYNC");
  console.log("=========================================");

  // Sign a valid token
  const token = jwt.sign({ sub: "test-admin-id", username: "admin" }, JWT_SECRET, {
    expiresIn: "1h"
  });

  try {
    const response = await axios.post(
      "http://localhost:4000/api/transcripts/bulk-super-sync",
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`
        },
        timeout: 10000
      }
    );

    console.log("Bulk Super Sync initiated successfully in the background!");
    console.log(JSON.stringify(response.data, null, 2));
    console.log("\nThe backend server is now running the full backfill sync for ALL shares in the background.");
    console.log("It will wipe the old cached files, download multiple order wins/capex reports, upload them to Drive, and register them.");

  } catch (err) {
    if (err.response) {
      console.error(`Request failed with status ${err.response.status}:`, err.response.data);
    } else {
      console.error("Request failed:", err.message);
    }
  }
}

triggerBulkSync();
