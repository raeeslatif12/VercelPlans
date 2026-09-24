import 'dotenv/config';
import fs from 'node:fs/promises';
import pg from 'pg';

const required = ['DATABASE_URL', 'JWT_SECRET', 'ADMIN_PHONE', 'ADMIN_PASSWORD'];
const missing = required.filter(name => !process.env[name]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
try {
  const schema = await fs.readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await pool.query(schema);
  const result = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('users','daily_tasks','withdrawals','plans','payment_methods','orders') ORDER BY table_name`);
  const tables = result.rows.map(row => row.table_name);
  const expected = ['daily_tasks', 'orders', 'payment_methods', 'plans', 'users', 'withdrawals'];
  if (tables.join(',') !== expected.join(',')) throw new Error('Schema verification did not find the expected tables.');
  console.log(`Schema applied. Verified tables: ${tables.join(', ')}`);
} catch {
  console.error('Database setup failed. Check DATABASE_URL, Neon availability, and schema permissions.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
