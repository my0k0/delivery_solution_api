import {
  pgEnum,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  pgTable,
} from 'drizzle-orm/pg-core';
import { users } from '../users/user.schema.js';

export const RIDER_VEHICLE_TYPES = [
  'BIKE',
  'MOTORBIKE',
  'CAR',
  'OTHER',
] as const;
export type RiderVehicleType = (typeof RIDER_VEHICLE_TYPES)[number];

export const riderVehicleTypeEnum = pgEnum(
  'rider_vehicle_type',
  RIDER_VEHICLE_TYPES,
);

export const riders = pgTable(
  'riders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    vehicleType: riderVehicleTypeEnum('vehicle_type').notNull().default('BIKE'),
    vehiclePlate: text('vehicle_plate'),
    licenseNo: text('license_no'),
    nrcNumber: text('nrc_number'),
    emergencyContactPhone: text('emergency_contact_phone'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('riders_user_unique').on(table.userId)],
);
