import { eq, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { DatabaseService } from '../common/database/database.service.js';
import { orders } from '../orders/order.schema.js';
import { riders } from '../riders/rider.schema.js';
import { users } from '../users/user.schema.js';
import { codToCollectSql } from '../reports/report-money.util.js';
import { riderHandovers } from './rider-handover.schema.js';

/**
 * The balance arithmetic, isolated so the three choices that matter are
 * reviewable in one screen:
 *
 * 1. **`DELIVERED` only.** `/reports/rider-collection` sums
 *    `DELIVERED ∪ AWAITING_APPROVAL`; a balance must not. Cash is accepted only
 *    for deliveries the office has already approved, so counting an unapproved
 *    one would keep every balance permanently positive and make a correct rider
 *    look short.
 * 2. **All-time, not date-ranged.** A balance does not reset when a report
 *    range does — that is the whole reason this exists beside the report.
 * 3. **Postgres `numeric` throughout**, reusing the canonical `codToCollectSql`
 *    unchanged and casting `::numeric(14, 2)::text` on the way out, so the value
 *    that reaches the client is the exact figure the database computed. The repo
 *    has one JS money adder (`moneyAdd`, float-based) and it must not touch a
 *    cumulative balance.
 *
 * Every function is correlated on the outer query's `riders.id`.
 */

/** All-time COD of one rider's `DELIVERED` orders. */
export function deliveredCodSql(riderColumn: AnyPgColumn): SQL<string> {
  return sql<string>`coalesce((
    select sum(${codToCollectSql(orders)})
    from ${orders}
    where ${orders.riderId} = ${riderColumn} and ${orders.status} = 'DELIVERED'
  ), 0)::numeric(14, 2)::text`;
}

/** Everything the office has accepted from one rider, whatever the method. */
export function acceptedSql(riderColumn: AnyPgColumn): SQL<string> {
  return sql<string>`coalesce((
    select sum(${riderHandovers.amount})
    from ${riderHandovers}
    where ${riderHandovers.riderId} = ${riderColumn}
  ), 0)::numeric(14, 2)::text`;
}

/** The most recent day a handover was received — what `lastReceivedOn` reports. */
export function lastReceivedOnSql(riderColumn: AnyPgColumn): SQL<string | null> {
  return sql<string | null>`(
    select to_char(max(${riderHandovers.receivedOn}), 'YYYY-MM-DD')
    from ${riderHandovers}
    where ${riderHandovers.riderId} = ${riderColumn}
  )`;
}

/**
 * The delivery date of the oldest delivery still carrying part of the balance,
 * on the convention that cash settles **oldest deliveries first**: walk the
 * rider's delivered orders in date order, keep a running total of COD, and the
 * first order whose running total exceeds what has been accepted is the first one
 * a short handover did not fully cover.
 *
 * The running total is a window function ordered by the *bucketed* delivery date
 * — `(delivered_at at time zone <api timezone>)::date`, the same expression
 * `rider-collection` buckets by, so the two never disagree about which day a
 * delivery belongs to — then tie-broken by `created_at` and `id`, which makes it
 * a total order so same-day deliveries cannot reorder between two runs.
 *
 * `to_char` rather than a bare `date`: a `date` reaches the driver as a JS `Date`
 * and serializing that is how a UTC shift silently moves a delivery a day
 * earlier. `min()` is safe here because the running total is monotonic, so the
 * set of exceeded rows is a suffix.
 */
export function oldestUnsettledDeliveredOnSql(
  riderColumn: AnyPgColumn,
  timeZone: string,
): SQL<string | null> {  return sql<string | null>`(
    select to_char(min(settled.delivered_on), 'YYYY-MM-DD')
    from (
      select (${orders.deliveredAt} at time zone ${timeZone})::date as delivered_on,
             sum(${codToCollectSql(orders)}) over (
               order by (${orders.deliveredAt} at time zone ${timeZone})::date,
                        ${orders.createdAt},
                        ${orders.id}
             ) as cumulative_cod
      from ${orders}
      where ${orders.riderId} = ${riderColumn} and ${orders.status} = 'DELIVERED'
    ) settled
    where settled.cumulative_cod > ${acceptedSql(riderColumn)}::numeric
  )`;
}

/** The application's database handle, as `DatabaseService` exposes it. */
type Database = DatabaseService['db'];

/**
 * One row per rider: what they delivered, what they handed back, the balance
 * between the two, and when the oldest unpaid delivery went out.
 *
 * Balance is derived **inside** the subquery and read from it, rather than
 * re-computed in the projection and again in the `outstandingOnly` filter — one
 * formula, so the filter and the number shown cannot drift apart.
 *
 * Every raw `sql` field carries an explicit alias, and that is load-bearing:
 * drizzle cannot build an outer `select() from (subquery)` over an unaliased raw
 * field, and it fails while *constructing* the query — a 500 with no SQL sent,
 * which a mocked unit test cannot see. `handover-balance.util.spec.ts` builds this
 * against a client that never connects, so the failure mode stays caught.
 */
export function riderBalanceRows(database: Database, timeZone: string) {
  return database
    .select({
      riderId: riders.id,
      riderName: users.name,
      riderStatus: users.status,
      deliveredCod: deliveredCodSql(riders.id).as('delivered_cod'),
      accepted: acceptedSql(riders.id).as('accepted'),
      balance:
        sql<string>`(${deliveredCodSql(riders.id)}::numeric - ${acceptedSql(riders.id)}::numeric)::numeric(14, 2)::text`.as(
          'balance',
        ),
      lastReceivedOn: lastReceivedOnSql(riders.id).as('last_received_on'),
      oldestUnsettledDeliveredOn: oldestUnsettledDeliveredOnSql(
        riders.id,
        timeZone,
      ).as('oldest_unsettled_delivered_on'),
    })
    .from(riders)
    .innerJoin(users, eq(users.id, riders.userId))
    .as('rider_balance_rows');
}
