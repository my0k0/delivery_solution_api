import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import { DatabaseService } from '../common/database/database.service.js';
import { OrderStateService } from './order-state.service.js';
import { ORDER_STATUSES, type OrderStatus } from './order.schema.js';

const EXPECTED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['PENDING', 'ASSIGNED', 'AWAITING_APPROVAL', 'CANCELLED'],
  AWAITING_APPROVAL: ['DELIVERED', 'ASSIGNED'],
  DELIVERED: [],
  CANCELLED: [],
};

function updateChain(returning: Array<{ id: string }>) {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(returning),
      }),
    }),
  };
}

describe('OrderStateService', () => {
  let service: OrderStateService;

  const transaction = {
    update: vi.fn(),
    insert: vi.fn(),
  };
  const databaseClient = {
    transaction: vi.fn(),
  };
  const database = { db: databaseClient };

  beforeEach(async () => {
    vi.resetAllMocks();
    const moduleReference = await Test.createTestingModule({
      providers: [
        OrderStateService,
        { provide: DatabaseService, useValue: database },
      ],
    }).compile();
    service = moduleReference.get(OrderStateService);
  });

  it('exposes exactly the approved status set and transition matrix', () => {
    expect(ORDER_STATUSES).toEqual([
      'PENDING',
      'ASSIGNED',
      'AWAITING_APPROVAL',
      'DELIVERED',
      'CANCELLED',
    ]);

    for (const status of ORDER_STATUSES) {
      expect(service.getAllowedTransitions(status)).toEqual(
        EXPECTED_TRANSITIONS[status],
      );
    }
  });

  it('allows exactly the matrix edges for non-partner orders', () => {
    for (const fromStatus of ORDER_STATUSES) {
      for (const toStatus of ORDER_STATUSES) {
        const isAllowed = EXPECTED_TRANSITIONS[fromStatus].includes(toStatus);
        expect(service.canTransition(fromStatus, toStatus)).toBe(isAllowed);
      }
    }
  });

  it('does not expose direct delivery as a general transition', () => {
    for (const fromStatus of ORDER_STATUSES) {
      for (const toStatus of ORDER_STATUSES) {
        expect(service.canTransition(fromStatus, toStatus)).toBe(
          EXPECTED_TRANSITIONS[fromStatus].includes(toStatus),
        );
      }
    }
  });

  it('rejects direct delivery through the generic transition API', () => {
    expect(() => service.assertTransition('ASSIGNED', 'DELIVERED')).toThrow(
      BadRequestException,
    );
    for (const terminalStatus of ['DELIVERED', 'CANCELLED'] as const) {
      expect(() =>
        service.assertTransition(terminalStatus, 'PENDING'),
      ).toThrow(BadRequestException);
    }
  });

  it('guards partner direct delivery by persisted assigneeType in the update', async () => {
    const where = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 'order-1' }]),
    });
    transaction.update.mockReturnValue({
      set: vi.fn().mockReturnValue({ where }),
    });
    const historyValues = vi.fn().mockResolvedValue(undefined);
    transaction.insert.mockReturnValue({ values: historyValues });
    databaseClient.transaction.mockImplementation(
      async (
        callback: (databaseTransaction: typeof transaction) => Promise<void>,
      ) => callback(transaction),
    );

    await service.markPartnerDeliveredInTransaction(
      transaction,
      'order-1',
      'user-1',
      new Date('2026-10-16T10:00:00.000Z'),
    );

    const guard = where.mock.calls[0][0];
    const query = new PgDialect().sqlToQuery(guard);
    expect(query.sql).toContain('"orders"."status" = $2');
    expect(query.sql).toContain('"orders"."assignee_type" = $3');
    expect(query.params).toEqual(['order-1', 'ASSIGNED', 'PARTNER']);
    expect(historyValues).toHaveBeenCalledWith(
      expect.objectContaining({ fromStatus: 'ASSIGNED', toStatus: 'DELIVERED' }),
    );
  });

  it('cannot directly deliver a rider order through the partner-only guarded update', async () => {
    const where = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([]),
    });
    transaction.update.mockReturnValue({
      set: vi.fn().mockReturnValue({ where }),
    });
    databaseClient.transaction.mockImplementation(
      async (
        callback: (databaseTransaction: typeof transaction) => Promise<void>,
      ) => callback(transaction),
    );

    await expect(
      service.markPartnerDeliveredInTransaction(
        transaction,
        'order-1',
        'user-1',
        new Date(),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    const query = new PgDialect().sqlToQuery(where.mock.calls[0][0]);
    expect(query.sql).toContain('"orders"."assignee_type" = $3');
    expect(query.params[2]).toBe('PARTNER');
    expect(transaction.insert).not.toHaveBeenCalled();
  });

  it('rejects invalid transitions with BadRequestException', () => {
    for (const terminalStatus of ['DELIVERED', 'CANCELLED'] as const) {
      expect(() => service.assertTransition(terminalStatus, 'PENDING')).toThrow(
        BadRequestException,
      );
    }
    expect(() => service.assertTransition('PENDING', 'DELIVERED')).toThrow(
      BadRequestException,
    );
  });

  it('applies a valid transition and stores status history atomically', async () => {
    transaction.update.mockReturnValue(updateChain([{ id: 'order-1' }]));
    const historyValues = vi.fn().mockResolvedValue(undefined);
    transaction.insert.mockReturnValue({ values: historyValues });
    databaseClient.transaction.mockImplementation(
      async (
        callback: (databaseTransaction: typeof transaction) => Promise<void>,
      ) => callback(transaction),
    );

    await service.applyTransition({
      orderId: 'order-1',
      fromStatus: 'PENDING',
      toStatus: 'ASSIGNED',
      changedBy: 'user-1',
      reason: 'Assigned to rider',
      internalNote: 'Confirmed availability',
      previousAssignee: null,
      newAssignee: {
        type: 'RIDER',
        riderId: 'rider-1',
        partnerId: null,
      },
    });

    expect(transaction.update).toHaveBeenCalledTimes(1);
    expect(transaction.insert).toHaveBeenCalledTimes(1);
    expect(historyValues).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        fromStatus: 'PENDING',
        toStatus: 'ASSIGNED',
        changedBy: 'user-1',
        reason: 'Assigned to rider',
        internalNote: 'Confirmed availability',
        previousAssignee: null,
        newAssignee: {
          type: 'RIDER',
          riderId: 'rider-1',
          partnerId: null,
        },
      }),
    );
  });

  it('rejects an invalid transition before opening a transaction', async () => {
    await expect(
      service.applyTransition({
        orderId: 'order-1',
        fromStatus: 'PENDING',
        toStatus: 'DELIVERED',
        changedBy: 'user-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(databaseClient.transaction).not.toHaveBeenCalled();
  });

  it('raises ConflictException when the persisted status is unexpected', async () => {
    transaction.update.mockReturnValue(updateChain([]));
    databaseClient.transaction.mockImplementation(
      async (
        callback: (databaseTransaction: typeof transaction) => Promise<void>,
      ) => callback(transaction),
    );

    await expect(
      service.applyTransition({
        orderId: 'order-1',
        fromStatus: 'PENDING',
        toStatus: 'ASSIGNED',
        changedBy: 'user-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.insert).not.toHaveBeenCalled();
  });
});
