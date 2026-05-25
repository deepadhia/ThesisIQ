import axios from "axios";
import fs from "node:fs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import path from "node:path";

// Load environment variables
dotenv.config({ path: ".env.local" });

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("JWT_SECRET is missing from .env.local!");
  process.exit(1);
}

async function testZip() {
  console.log("=========================================");
  console.log("TESTING ZIP DOWNLOAD FOR SKIPPER");
  console.log("=========================================");

  // Sign a valid token
  const token = jwt.sign({ sub: "test-admin-id", username: "admin" }, JWT_SECRET, {
    expiresIn: "1h"
  });

  try {
    const response = await axios.get("http://localhost:4000/api/transcripts/download-zip/SKIPPER", {
      headers: {
        Authorization: `Bearer ${token}`
      },
      responseType: "arraybuffer"
    });

    console.log("Successfully fetched ZIP from backend!");
    console.log(`ZIP buffer size: ${response.data.byteLength} bytes`);

    const savePath = "scratch/skipper_filings.zip";
    fs.writeFileSync(savePath, Buffer.from(response.data));
    console.log(`Saved ZIP archive to: ${savePath}`);

  } catch (err) {
    if (err.response) {
      const errorText = Buffer.from(err.response.data).toString("utf-8");
      console.error(`Request failed with status ${err.response.status}:`, errorText);
    } else {
      console.error("Request failed:", err.message);
    }
  }
}

testZip();
