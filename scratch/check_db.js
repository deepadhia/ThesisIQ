import { pool } from '../backend/db/pool.js';

async function checkDb() {
  console.log("Connecting to database...");
  try {
    // Check connection and list all tables
    const tablesRes = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    console.log("Tables in public schema:");
    tablesRes.rows.forEach(r => console.log(`  - ${r.table_name}`));

    // Check app_admin_users table if it exists
    const hasAdminTable = tablesRes.rows.some(r => r.table_name === 'app_admin_users');
    if (hasAdminTable) {
      const usersRes = await pool.query("SELECT id, username, created_at FROM app_admin_users");
      console.log(`\napp_admin_users count: ${usersRes.rows.length}`);
      usersRes.rows.forEach(u => console.log(`  - ${u.username} (created at ${u.created_at})`));
    } else {
      console.log("\n[WARNING] app_admin_users table does not exist!");
    }
  } catch (err) {
    console.error("Database query failed:", err);
  } finally {
    await pool.end();
  }
}

checkDb();
