import { it, expect, vi } from 'vitest';
const query = vi.hoisted(() => vi.fn(async () => ({ rows: [] })));
vi.mock('../config/env.js', () => ({ DATABASE_URL: 'postgres://test:test@localhost/test' }));
vi.mock('pg', () => ({ default: { Pool: class { query = query; on() {} } } }));

it('importing the connection pool never mutates production data (including dry-run/audit scripts)', async () => {
  await import('../db/pool.js');
  expect(query).not.toHaveBeenCalled();
});
