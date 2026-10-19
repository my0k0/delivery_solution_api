import { afterAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../common/database/schema.js';
import { riderBalanceRows } from './handover-balance.util.js';

/**
 * `postgres()` connects lazily and `toSQL()` only renders, so nothing here
 * dials. That matters: the failure these tests guard against happens while the
 * query is being *built*, before a single byte is sent — an unaliased raw `sql`
 * field inside a derived table makes drizzle throw on the outer
 * `select() from (subquery)`, which reached production as a 500 with no SQL in
 * the log and passed every mocked unit test in the service spec.
 *
 * No connection also means these run wherever `pnpm test` runs, with no database.
 */
const client = postgres('postgres://unused:unused@127.0.0.1:1/unused', {
  max: 1,
});
const database = drizzle(client, { schema });

afterAll(async () => {
  await client.end();
});

function buildBalancesSql(): { text: string; params: unknown[] } {
  const rows = riderBalanceRows(database, 'Asia/Yangon');
  const built = database.select().from(rows).toSQL();
  return { text: built.sql, params: built.params };
}

describe('riderBalanceRows', () => {
  it('builds a derived table the outer query can select from', () => {
    const { text } = buildBalancesSql();

    expect(text).toContain('"rider_balance_rows"');
    expect(text).toContain('from "riders"');
    expect(text).toContain('inner join "users"');
  });

  it('aliases every raw field the outer query reads', () => {
    const { text } = buildBalancesSql();

    for (const alias of [
      'delivered_cod',
      'accepted',
      'balance',
      'last_received_on',
      'oldest_unsettled_delivered_on',
    ]) {
      expect(text).toContain(`as "${alias}"`);
    }
  });

  it('counts only DELIVERED orders as delivered COD', () => {
    const { text } = buildBalancesSql();

    // Three times, all in the derived table: once in the projected figure, once
    // inside the balance formula, once in the FIFO window that finds the oldest
    // unsettled delivery. Every copy must agree on the scope.
    expect(text.match(/"orders"."status" = 'DELIVERED'/g)).toHaveLength(3);
    expect(text).not.toContain('AWAITING_APPROVAL');
  });

  it('derives the balance as delivered COD minus accepted cash', () => {
    const { text } = buildBalancesSql();
    const normalized = text.replace(/\s+/g, ' ');

    // Inline, because a subquery cannot read its own aliases. The delivered-COD
    // text figure is cast back and something is subtracted from it.
    expect(normalized).toMatch(/::numeric\(14, 2\)::text::numeric - /);
    expect(normalized).toContain('coalesce(( select sum("rider_handovers"."amount")');
  });

  it('buckets delivery dates in the configured timezone, not UTC', () => {
    const { params } = buildBalancesSql();

    expect(params).toEqual(['Asia/Yangon', 'Asia/Yangon']);
  });
});
