import { pool } from '../backend/db/pool.js';
import bcrypt from 'bcryptjs';

async function test() {
  try {
    const { rows } = await pool.query(
      "SELECT id, username, password_hash FROM app_admin_users WHERE username = $1",
      ['admin']
    );
    console.log("User row fetched successfully:", rows[0]);
    if (rows[0]) {
      const match = await bcrypt.compare('admin123', rows[0].password_hash);
      console.log("Bcrypt comparison match (admin123):", match);
    }
  } catch (err) {
    console.error("Test failed:", err);
  } finally {
    await pool.end();
  }
}
test();
