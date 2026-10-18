import {
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const townships = pgTable(
  'townships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    defaultDeliveryFee: numeric('default_delivery_fee', {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default('0'),
    defaultCommissionFee: numeric('default_commission_fee', {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default('0'),
    leadTimeDays: integer('lead_time_days').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('townships_name_unique').on(table.name)],
);
