import type { OrderStatus } from '../orders/order.schema.js';

export const SHOP_DISPLAY_STATUSES = [
  'RECEIVED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
] as const;

export type ShopDisplayStatus = (typeof SHOP_DISPLAY_STATUSES)[number];

export function toShopDisplayStatus(status: OrderStatus): ShopDisplayStatus {
  switch (status) {
    case 'PENDING':
      return 'RECEIVED';
    case 'ASSIGNED':
    case 'AWAITING_APPROVAL':
      return 'OUT_FOR_DELIVERY';
    case 'DELIVERED':
      return 'DELIVERED';
    case 'CANCELLED':
      return 'CANCELLED';
  }
}

/**
 * A cancelled order is terminal and needs no chase, so attention is only about
 * open orders: overdue, or sent back / postponed with a reason.
 */
export function shopOrderNeedsAttention(
  status: OrderStatus,
  estimatedDeliveryDate: string | null,
  today: string,
  latestPostponeOrSendBackHasReason: boolean,
): boolean {
  const isOpen = status === 'PENDING' || status === 'ASSIGNED' || status === 'AWAITING_APPROVAL';
  return isOpen && (
    (estimatedDeliveryDate !== null && estimatedDeliveryDate < today) ||
    latestPostponeOrSendBackHasReason
  );
}

export interface ShopHistoryEventInput {
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  createdAt: Date;
  reason: string | null;
  internalNote?: string | null;
}

export interface ShopHistoryEvent {
  createdAt: string;
  displayStatus: ShopDisplayStatus;
  reason: string | null;
}

export function toShopVisibleHistory(
  events: readonly ShopHistoryEventInput[],
): ShopHistoryEvent[] {
  return events
    .filter((event) =>
      event.fromStatus === null ||
      toShopDisplayStatus(event.fromStatus) !== toShopDisplayStatus(event.toStatus) ||
      (event.reason !== null && event.reason.length > 0),
    )
    .map((event) => ({
      createdAt: event.createdAt.toISOString(),
      displayStatus: toShopDisplayStatus(event.toStatus),
      reason: event.reason,
    }));
}
