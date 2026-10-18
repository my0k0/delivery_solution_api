import {
  check,
  date,
  index,
  boolean,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { customers } from '../customers/customer.schema.js';
import { deliveryPartners } from '../delivery-partners/delivery-partner.schema.js';
import { riders } from '../riders/rider.schema.js';
import { shops } from '../shops/shop.schema.js';
import { townships } from '../townships/township.schema.js';

export const ORDER_STATUSES = [
  'PENDING',
  'ASSIGNED',
  'AWAITING_APPROVAL',
  'DELIVERED',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const orderStatusEnum = pgEnum('order_status', ORDER_STATUSES);

export const ASSIGNEE_TYPES = ['RIDER', 'PARTNER'] as const;
export type AssigneeType = (typeof ASSIGNEE_TYPES)[number];

export const assigneeTypeEnum = pgEnum('assignee_type', ASSIGNEE_TYPES);

export interface AssigneeSnapshot {
  type: AssigneeType;
  riderId: string | null;
  partnerId: string | null;
}

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    trackingCode: text('tracking_code').notNull(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    townshipId: uuid('township_id').references(() => townships.id, {
      onDelete: 'restrict',
    }),
    assigneeType: assigneeTypeEnum('assignee_type'),
    riderId: uuid('rider_id').references(() => riders.id, {
      onDelete: 'restrict',
    }),
    partnerId: uuid('partner_id').references(() => deliveryPartners.id, {
      onDelete: 'restrict',
    }),
    partnerTrackingNo: text('partner_tracking_no'),
    packageInfo: jsonb('package_info'),
    packagePrice: numeric('package_price', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    deliveryFee: numeric('delivery_fee', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    codAmount: numeric('cod_amount', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    isPackagePaidToShop: boolean('is_package_paid_to_shop')
      .notNull()
      .default(false),
    isFeePaidToShop: boolean('is_fee_paid_to_shop').notNull().default(false),
    partnerFee: numeric('partner_fee', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    commissionFee: numeric('commission_fee', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    /**
     * What the company actually paid this shop for this order, snapshotted from
     * `packagePrice` at the moment of the advance. Never follows a later
     * `packagePrice` edit — money that moved does not change retroactively, and
     * Phase 2's reclaim subtracts from this value.
     */
    shopAdvanceAmount: numeric('shop_advance_amount', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    /** `null` = not yet advanced. Always written together with the amount. */
    shopAdvancedAt: timestamp('shop_advanced_at', { withTimezone: true }),
    estimatedDeliveryDate: date('estimated_delivery_date', { mode: 'date' }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    deliveryAddress: text('delivery_address'),
    cancelReason: text('cancel_reason'),
    status: orderStatusEnum('status').notNull().default('PENDING'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'orders_assignee_consistency_check',
      sql`coalesce(((${table.assigneeType} is null and ${table.riderId} is null and ${table.partnerId} is null) or (${table.assigneeType} = 'RIDER' and ${table.riderId} is not null and ${table.partnerId} is null) or (${table.assigneeType} = 'PARTNER' and ${table.partnerId} is not null and ${table.riderId} is null)), false)`,
    ),
    uniqueIndex('orders_tracking_code_unique').on(table.trackingCode),
    index('orders_status_idx').on(table.status),
    index('orders_shop_idx').on(table.shopId),
    index('orders_customer_idx').on(table.customerId),
    index('orders_created_at_idx').on(table.createdAt),
    index('orders_status_created_at_idx').on(table.status, table.createdAt),
    index('orders_delivered_at_idx').on(table.deliveredAt),
    index('orders_township_idx').on(table.townshipId),
    index('orders_rider_idx').on(table.riderId),
    /** Supports the "not yet advanced for this shop" work list. */
    index('orders_shop_advance_idx').on(table.shopId, table.shopAdvancedAt),
  ],
);
