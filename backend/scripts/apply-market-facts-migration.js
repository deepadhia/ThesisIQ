/** Applies only the approved nullable-market-facts migration, with a durable backup. Dry-run by default. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db/pool.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export async function applyMarketFactsMigration(db, { apply = false, backupDir = path.join(root, 'scratch'), writeBackup = (file, data) => fs.writeFileSync(file, data) } = {}) {
  const name = '20261108010000_allow_unknown_market_facts.sql';
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8');
  const client = await db.connect();
  try {
    await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    await client.query("SET LOCAL lock_timeout = '3s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    const schema = (await client.query("SELECT column_name,is_nullable,column_default,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='market_data_snapshots' ORDER BY ordinal_position")).rows;
    if (!schema.length) throw new Error('market_data_snapshots is missing');
    if (!apply) { await client.query('ROLLBACK'); return { applied: false, migration: name, schema }; }
    await client.query('LOCK TABLE public.market_data_snapshots IN ACCESS EXCLUSIVE MODE');
    const rows = (await client.query('SELECT * FROM public.market_data_snapshots')).rows;
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `market-facts-schema-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeBackup(backupPath, JSON.stringify({ migration: name, savedAt: new Date().toISOString(), schema, rows }, null, 2));
    // Keep the reviewed migration and its registration in this single transaction.
    const body = sql.replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '');
    await client.query(body);
    await client.query('CREATE TABLE IF NOT EXISTS public.schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    await client.query('INSERT INTO public.schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
    const after = (await client.query("SELECT column_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='market_data_snapshots' ORDER BY ordinal_position")).rows;
    const requiredUnknowns = ['enterprise_value', 'net_debt', 'ttm_revenue', 'ttm_ebitda', 'ttm_ebit', 'ttm_pat', 'ttm_eps', 'pe_ratio', 'ev_ebitda_ratio'];
    if (requiredUnknowns.some(column => !after.some(c => c.column_name === column && c.is_nullable === 'YES'))) throw new Error('Migration verification failed: optional facts remain mandatory');
    for (const column of ['ticker', 'period', 'market_data_as_of', 'market_data_retrieved_at', 'market_data_source', 'share_price', 'shares_outstanding', 'market_cap']) {
      if (!after.some(c => c.column_name === column && c.is_nullable === 'NO')) throw new Error(`Required quote/provenance constraint lost: ${column}`);
    }
    await client.query('COMMIT');
    return { applied: true, migration: name, backupPath, backedUpRows: rows.length, schema: after };
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await applyMarketFactsMigration(pool, { apply: process.argv.includes('--apply') }), null, 2)); }
  catch (err) { console.error(`[MIGRATION] ${err.message}`); process.exitCode = 1; }
  finally { await pool.end(); }
}
