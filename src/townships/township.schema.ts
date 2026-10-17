import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { deliveryPartners } from '../delivery-partners/delivery-partner.schema.js';
import { riders } from '../riders/rider.schema.js';

export const TOWNSHIP_DEFAULT_ASSIGNEE_TYPES = ['RIDER', 'PARTNER'] as const;
export type TownshipDefaultAssigneeType =
  (typeof TOWNSHIP_DEFAULT_ASSIGNEE_TYPES)[number];

export const townshipDefaultAssigneeTypeEnum = pgEnum(
  'township_default_assignee_type',
  TOWNSHIP_DEFAULT_ASSIGNEE_TYPES,
);

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
    defaultAssigneeType: townshipDefaultAssigneeTypeEnum(
      'default_assignee_type',
    ),
    defaultRiderId: uuid('default_rider_id').references(() => riders.id, {
      onDelete: 'restrict',
    }),
    defaultPartnerId: uuid('default_partner_id').references(
      () => deliveryPartners.id,
      { onDelete: 'restrict' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'townships_default_assignee_consistency_check',
      sql`coalesce(((${table.defaultAssigneeType} is null and ${table.defaultRiderId} is null and ${table.defaultPartnerId} is null) or (${table.defaultAssigneeType} = 'RIDER' and ${table.defaultRiderId} is not null and ${table.defaultPartnerId} is null) or (${table.defaultAssigneeType} = 'PARTNER' and ${table.defaultPartnerId} is not null and ${table.defaultRiderId} is null)), false)`,
    ),
    uniqueIndex('townships_name_unique').on(table.name),
    index('townships_default_rider_idx').on(table.defaultRiderId),
    index('townships_default_partner_idx').on(table.defaultPartnerId),
  ],
);
