import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Node-specific data directory so we don't touch Python's output
// Result: project-root / data_node
export const DATA_DIR = path.resolve(__dirname, "..", "..", "data_node");

// Fallback when run standalone (CLI). When invoked from backend API, symbols come from database.
export const WATCHLIST = [
  "ANANTRAJ",
  "INOXINDIA",
  "HBLENGINE",
  "LUMAXTECH",
  "QPOWER",
  "TIMETECHNO",
  "GRAVITA",
  "CCL",
];

// Default history window (in days) – last 3 quarters
export const DEFAULT_HISTORY_DAYS = 3 * 92;

// Mapping from history-window flag to days
export const HISTORY_WINDOWS = {
  "6m": 182,
  "1y": 365,
  "2y": 730,
  "3y": 1095,
  "3q": 3 * 92,
};

// Throttle between NSE requests (seconds)
export const REQUEST_DELAY_MS = 500;

export const NSE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer:
    "https://www.nseindia.com/companies-listing/corporate-filings-announcements",
};

