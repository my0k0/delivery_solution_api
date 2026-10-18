import { relations } from 'drizzle-orm';
import { customers } from '../../customers/customer.schema.js';
import { deliveryPartners } from '../../delivery-partners/delivery-partner.schema.js';
import { orderFieldAudit } from '../../orders/order-field-audit.schema.js';
import { orderStatusHistory } from '../../orders/order-status-history.schema.js';
import { orders } from '../../orders/order.schema.js';
import { permissions } from '../../permissions/permissions.schema.js';
import { riders } from '../../riders/rider.schema.js';
import { role_permissions } from '../../roles/role-permissions.schema.js';
import { roles } from '../../roles/roles.schema.js';
import { shops } from '../../shops/shop.schema.js';
import { townships } from '../../townships/township.schema.js';
import { users } from '../../users/user.schema.js';

export const usersRelations = relations(users, ({ one, many }) => ({
  role: one(roles, {
    fields: [users.roleId],
    references: [roles.id],
  }),
  shop: one(shops, {
    fields: [users.shopId],
    references: [shops.id],
  }),
  orderStatusHistories: many(orderStatusHistory),
  orderFieldAudits: many(orderFieldAudit),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  users: many(users),
  permissions: many(role_permissions),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  roles: many(role_permissions),
}));

export const rolePermissionsRelations = relations(
  role_permissions,
  ({ one }) => ({
    role: one(roles, {
      fields: [role_permissions.roleId],
      references: [roles.id],
    }),
    permission: one(permissions, {
      fields: [role_permissions.permissionId],
      references: [permissions.id],
    }),
  }),
);

export const shopsRelations = relations(shops, ({ many }) => ({
  users: many(users),
  orders: many(orders),
}));

export const customersRelations = relations(customers, ({ many }) => ({
  orders: many(orders),
}));

export const ridersRelations = relations(riders, ({ one, many }) => ({
  user: one(users, { fields: [riders.userId], references: [users.id] }),
  orders: many(orders),
  defaultTownships: many(townships),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  shop: one(shops, { fields: [orders.shopId], references: [shops.id] }),
  customer: one(customers, {
    fields: [orders.customerId],
    references: [customers.id],
  }),
  township: one(townships, {
    fields: [orders.townshipId],
    references: [townships.id],
  }),
  rider: one(riders, { fields: [orders.riderId], references: [riders.id] }),
  partner: one(deliveryPartners, {
    fields: [orders.partnerId],
    references: [deliveryPartners.id],
  }),
  history: many(orderStatusHistory),
  fieldAudit: many(orderFieldAudit),
}));

export const orderStatusHistoryRelations = relations(
  orderStatusHistory,
  ({ one }) => ({
    order: one(orders, {
      fields: [orderStatusHistory.orderId],
      references: [orders.id],
    }),
    actor: one(users, {
      fields: [orderStatusHistory.changedBy],
      references: [users.id],
    }),
  }),
);

export const orderFieldAuditRelations = relations(
  orderFieldAudit,
  ({ one }) => ({
    order: one(orders, {
      fields: [orderFieldAudit.orderId],
      references: [orders.id],
    }),
    actor: one(users, {
      fields: [orderFieldAudit.actorId],
      references: [users.id],
    }),
  }),
);

export const townshipsRelations = relations(townships, ({ many }) => ({
  orders: many(orders),
}));

export const deliveryPartnersRelations = relations(
  deliveryPartners,
  ({ many }) => ({
    orders: many(orders),
  }),
);
