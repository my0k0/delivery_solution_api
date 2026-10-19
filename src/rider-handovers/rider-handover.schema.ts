import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { riders } from '../riders/rider.schema.js';
import { users } from '../users/user.schema.js';

export const HANDOVER_METHODS = ['KPAY', 'CASH', 'BANK_TRANSFER'] as const;
export type HandoverMethod = (typeof HANDOVER_METHODS)[number];

/**
 * Declared beside its table, exactly as `riderVehicleTypeEnum` sits beside the
 * riders table. KPay is the usual method, cash in person the exception and
 * online banking the third — descriptive only, it changes no arithmetic and no
 * report total.
 */
export const handoverMethodEnum = pgEnum('handover_method', HANDOVER_METHODS);

export const riderHandovers = pgTable(
  'rider_handovers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * `restrict`, not `cascade`: a rider with money history cannot be deleted,
     * the same FK behaviour `orders.rider_id` already has.
     */
    riderId: uuid('rider_id')
      .notNull()
      .references(() => riders.id, { onDelete: 'restrict' }),
    /**
     * The cash received, one amount per handover. `0.00` is legal and means
     * "this row no longer counts" — how a duplicate or a reversed transfer is
     * expressed when corrected. A *negative balance* on the balances page is a
     * different thing: a recording mistake to fix, never a state this row can
     * hold, which is what the `>= 0` check enforces.
     */
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    /**
     * The day the office **received** it, never the collection date — which is
     * what makes a next-day handover a non-event. Left in drizzle's default
     * string mode so the wire value is `YYYY-MM-DD` and never an ISO-shifted
     * `Date`.
     */
    receivedOn: date('received_on').notNull(),
    method: handoverMethodEnum('method').notNull(),
    /** Free text; the KPay reference goes here rather than a structured column. */
    note: text('note'),
    recordedBy: uuid('recorded_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('rider_handovers_amount_non_negative', sql`${table.amount} >= 0`),
    /** Serves the history list and the balance join alike. */
    index('rider_handovers_rider_received_idx').on(
      table.riderId,
      table.receivedOn,
    ),
    index('rider_handovers_received_idx').on(table.receivedOn),
  ],
);
