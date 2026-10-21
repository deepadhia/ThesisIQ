import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Backend env is separate from frontend (VITE_*). For local dev use .env.local at repo root;
// for deployment set DATABASE_URL, PORT, GOOGLE_* etc. in your host (e.g. Railway, Render).
const repoRoot = path.resolve(__dirname, "../..");
dotenv.config({ path: path.join(repoRoot, ".env.local") });
dotenv.config({ path: path.join(repoRoot, ".env") });

export const DATABASE_URL = process.env.DATABASE_URL || "";
export const PORT = Number(process.env.PORT || 4000);

/** Required for admin login JWT signing (set in .env.local, e.g. openssl rand -hex 32). */
export const JWT_SECRET = (process.env.JWT_SECRET || "").trim();

/** NVIDIA NIM (Geforce Now) API Key */
export const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "";

/** Telegram Bot Token and Destination Chat ID */
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
export const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

/** Google Gemini API Key for Multimodal OCR and Concall Audio Processing */
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

/** Supabase project URL and anon key for proxying Edge Functions (fetch-price, fetch-financials). */
export const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

if (!DATABASE_URL) {
  // Backend cannot function without a DB; fail fast
  console.error("DATABASE_URL is not set. Add it to .env.local or your environment.");
  process.exit(1);
}

if (!JWT_SECRET) {
  console.warn("[WARN] JWT_SECRET is not set. Admin authentication features will be disabled.");
}

