import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { getDriveStatus } from "./backend/services/drive.service.js";

async function check() {
  const status = await getDriveStatus();
  console.log("Drive Status:", status);
}

check();
