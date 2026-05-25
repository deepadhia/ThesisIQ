import axios from "axios";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("JWT_SECRET is missing from .env.local!");
  process.exit(1);
}

async function triggerSync() {
  console.log("=========================================");
  console.log("TRIGGERING SUPER SYNC FOR ANANTRAJ");
  console.log("=========================================");

  // Sign a valid token
  const token = jwt.sign({ sub: "test-admin-id", username: "admin" }, JWT_SECRET, {
    expiresIn: "1h"
  });

  try {
    const response = await axios.post(
      "http://localhost:4000/api/transcripts/super-sync",
      {
        stockId: "a35dd629-755a-451a-a9b6-a38ff532ef69",
        ticker: "ANANTRAJ"
      },
      {
        headers: {
          Authorization: `Bearer ${token}`
        },
        timeout: 180000 // 3 minutes timeout since downloading may take time
      }
    );

    console.log("Super sync completed successfully!");
    console.log(JSON.stringify(response.data, null, 2));

  } catch (err) {
    if (err.response) {
      console.error(`Request failed with status ${err.response.status}:`, err.response.data);
    } else {
      console.error("Request failed:", err.message);
    }
  }
}

triggerSync();
