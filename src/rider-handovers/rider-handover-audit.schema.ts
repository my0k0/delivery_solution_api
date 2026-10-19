import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from '../users/user.schema.js';
import { riderHandovers } from './rider-handover.schema.js';

/**
 * One row per changed field per correction, mirroring `order_field_audit` field
 * for field. This is what makes an edit in place safe: the row still reads as
 * its current state, and its history lives beside it instead of in a log nobody
 * opens.
 *
 * `restrict` on the parent means the trail cannot be orphaned — the schema, not
 * the service, is what guarantees a handover is never deleted.
 */
export const riderHandoverAudit = pgTable(
  'rider_handover_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    handoverId: uuid('handover_id')
      .notNull()
      .references(() => riderHandovers.id, { onDelete: 'restrict' }),
    field: text('field').notNull(),
    oldValue: jsonb('old_value').$type<unknown>(),
    newValue: jsonb('new_value').$type<unknown>(),
    actorId: uuid('actor_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('rider_handover_audit_handover_created_idx').on(
      table.handoverId,
      table.createdAt,
    ),
    index('rider_handover_audit_actor_idx').on(table.actorId),
  ],
);
