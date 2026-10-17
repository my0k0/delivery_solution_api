import { shopOrderNeedsAttention, toShopDisplayStatus, toShopVisibleHistory } from './shop-display-status.util.js';
import type { OrderStatus } from '../orders/order.schema.js';

describe('shop portal status and privacy mapping', () => {
  it.each([
    ['PENDING', 'RECEIVED'],
    ['ASSIGNED', 'OUT_FOR_DELIVERY'],
    ['AWAITING_APPROVAL', 'OUT_FOR_DELIVERY'],
    ['DELIVERED', 'DELIVERED'],
    ['CANCELLED', 'CANCELLED'],
  ] as const)('maps %s to %s', (status, displayStatus) => {
    expect(toShopDisplayStatus(status)).toBe(displayStatus);
  });

  it('derives needsAttention for overdue open and reason-bearing open orders only', () => {
    const cases: Array<[OrderStatus, string | null, boolean, boolean]> = [
      ['PENDING', '2026-10-15', false, true],
      ['ASSIGNED', '2026-10-16', true, true],
      ['AWAITING_APPROVAL', null, false, false],
      ['DELIVERED', '2026-10-15', true, false],
      ['CANCELLED', '2026-10-15', true, false],
    ];
    for (const [status, estimatedDate, hasReason, expected] of cases) {
      expect(shopOrderNeedsAttention(status, estimatedDate, '2026-10-16', hasReason)).toBe(expected);
    }
  });

  it('hides reassignment and same-display-status history, exposing only shop-visible reasons', () => {
    const date = new Date('2026-10-16T00:00:00.000Z');
    const visible = toShopVisibleHistory([
      { fromStatus: null, toStatus: 'ASSIGNED', createdAt: date, reason: null },
      { fromStatus: 'ASSIGNED', toStatus: 'ASSIGNED', createdAt: date, reason: null },
      { fromStatus: 'ASSIGNED', toStatus: 'AWAITING_APPROVAL', createdAt: date, reason: null },
      { fromStatus: 'AWAITING_APPROVAL', toStatus: 'ASSIGNED', createdAt: date, reason: 'Please retry delivery', internalNote: 'private office note' },
      { fromStatus: 'ASSIGNED', toStatus: 'PENDING', createdAt: date, reason: null },
    ]);

    expect(visible).toEqual([
      { createdAt: date.toISOString(), displayStatus: 'OUT_FOR_DELIVERY', reason: null },
      { createdAt: date.toISOString(), displayStatus: 'OUT_FOR_DELIVERY', reason: 'Please retry delivery' },
      { createdAt: date.toISOString(), displayStatus: 'RECEIVED', reason: null },
    ]);
    expect(JSON.stringify(visible)).not.toContain('internalNote');
    expect(JSON.stringify(visible)).not.toContain('private office note');
  });
});
