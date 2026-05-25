import fs from 'node:fs';
import path from 'node:path';
import { pool } from '../backend/db/pool.js';

async function run() {
  console.log("⚡ Applying shadow snapshots migration...");
  
  const migrationPath = './supabase/migrations/20260517000000_snapshot_shadow_table.sql';
  const sql = fs.readFileSync(migrationPath, 'utf8');

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("✅ Shadow table 'quarterly_snapshots_shadow' successfully created/verified in DB!");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Failed to apply migration:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
