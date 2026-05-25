import { pool } from "../db/pool.js";

async function clear() {
  const ticker = process.argv[2];
  try {
    if (ticker) {
      console.log(`Clearing ALL announcements for ${ticker} to re-run...`);
      await pool.query(
        "DELETE FROM corporate_announcements WHERE ticker = $1",
        [ticker]
      );
    } else {
      console.log("Clearing all ignored announcements from last 7 days...");
      await pool.query(
        "DELETE FROM corporate_announcements WHERE status = 'ignored' AND processed_at > NOW() - interval '7 days'"
      );
    }
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

clear();
