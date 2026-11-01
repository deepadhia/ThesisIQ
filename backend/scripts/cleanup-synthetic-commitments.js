import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../db/pool.js";

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");

  const { rows } = await pool.query(
    `SELECT id, ticker, metric, statement, target_value, status, timeline, created_at
     FROM management_commitments
     WHERE statement LIKE '%₹X%'
        OR target_value LIKE '%₹X%'
        OR statement LIKE '%TPL Plastech%'
        OR target_value LIKE '%TPL Plastech%'
        OR statement ILIKE '%example%'`
  );

  console.log(`Found ${rows.length} synthetic / leaked template commitment records:`);
  for (const r of rows) {
    console.log(` - [${r.id}] ${r.ticker.padEnd(11)} | metric: ${r.metric} | target: ${r.target_value} | stmt: ${r.statement?.slice(0, 60)}`);
  }

  if (rows.length === 0) {
    console.log("No synthetic commitments found. Database is clean.");
    await pool.end();
    return;
  }

  if (!apply) {
    console.log("\n(dry run — pass --apply to delete synthetic records after backup)");
    await pool.end();
    return;
  }

  const backupDir = path.resolve(here, "../../scratch");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `deleted-commitments-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(rows, null, 2));
  console.log(`\nBackup of deleted records written to ${backupPath}`);

  const ids = rows.map(r => r.id);
  const deleteResult = await pool.query(
    `DELETE FROM management_commitments WHERE id = ANY($1::uuid[])`,
    [ids]
  );
  console.log(`Successfully deleted ${deleteResult.rowCount} synthetic commitment record(s).`);

  await pool.end();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err); process.exit(1); });
}

