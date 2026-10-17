import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DatabaseService } from '../common/database/database.service.js';
import { PermissionService } from '../permissions/permissions.service.js';
import { OrderStateService } from './order-state.service.js';
import { OrdersService } from './orders.service.js';

function baseOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    trackingCode: 'ORD-01J8ZQ4C7M3W9X2K5T8R1V6B0P',
    shopId: '22222222-2222-4222-8222-222222222222',
    customerId: '33333333-3333-4333-8333-333333333333',
    townshipId: null,
    assigneeType: null,
    riderId: null,
    partnerId: null,
    partnerTrackingNo: null,
    packageInfo: null,
    packagePrice: '0.00',
    deliveryFee: '0.00',
    isPackagePaidToShop: false,
    isFeePaidToShop: false,
    partnerFee: '0.00',
    commissionFee: '0.00',
    estimatedDeliveryDate: null,
    deliveredAt: null,
    deliveryAddress: null,
    cancelReason: null,
    status: 'PENDING' as const,
    notes: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function baseHistory(overrides: Record<string, unknown> = {}) {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    orderId: baseOrder().id,
    fromStatus: null,
    toStatus: 'PENDING' as const,
    changedBy: '55555555-5555-4555-8555-555555555555',
    note: 'Order registered',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function queryChain(result: unknown) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    for: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(result).then(resolve),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.for.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.offset.mockReturnValue(chain);
  return chain;
}

describe('OrdersService', () => {
  let service: OrdersService;

  const queryShops = { findFirst: vi.fn() };
  const queryCustomers = { findFirst: vi.fn() };
  const queryTownships = { findFirst: vi.fn() };
  const queryRiders = { findFirst: vi.fn() };
  const queryDeliveryPartners = { findFirst: vi.fn() };
  const db = {
    query: {
      shops: queryShops,
      customers: queryCustomers,
      townships: queryTownships,
      riders: queryRiders,
      deliveryPartners: queryDeliveryPartners,
    },
    select: vi.fn(),
    transaction: vi.fn(),
  };
  const database = { db };
  const orderState = {
    applyTransitionInTransaction: vi.fn(),
    recordInitialStateInTransaction: vi.fn(),
  };
  const permissions = { getEffectivePermissions: vi.fn().mockResolvedValue([]) };

  function prepareUpdateTransaction(initialOrder: ReturnType<typeof baseOrder>) {
    let storedOrder: Record<string, unknown> = { ...initialOrder };
    const auditValues = vi.fn().mockResolvedValue(undefined);
    const transactionClient = {
      select: vi.fn(() => queryChain([storedOrder])),
      update: vi.fn(() => ({
        set: vi.fn((values: Record<string, unknown>) => ({
          where: vi.fn(async () => {
            storedOrder = { ...storedOrder, ...values };
          }),
        })),
      })),
      insert: vi.fn(() => ({ values: auditValues })),
    };
    db.select.mockReturnValueOnce(queryChain([initialOrder]));
    db.transaction.mockImplementation(
      async (callback: (transaction: typeof transactionClient) => Promise<unknown>) => callback(transactionClient),
    );
    orderState.applyTransitionInTransaction.mockImplementation(async (
      _transaction: unknown,
      transition: { toStatus: string; updates?: Record<string, unknown> },
    ) => {
      storedOrder = {
        ...storedOrder,
        ...transition.updates,
        status: transition.toStatus,
        updatedAt: new Date(),
      };
    });
    return { auditValues };
  }

  beforeEach(async () => {
    vi.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: DatabaseService, useValue: database },
        { provide: OrderStateService, useValue: orderState },
        { provide: PermissionService, useValue: permissions },
        { provide: ConfigService, useValue: { get: () => 'Asia/Yangon' } },
      ],
    }).compile();
    service = moduleRef.get(OrdersService);
  });

  it('lists orders with pagination metadata', async () => {
    db.select
      .mockReturnValueOnce(queryChain([baseOrder()]))
      .mockReturnValueOnce(queryChain([{ count: 1 }]));

    const result = await service.list({ page: 1, perPage: 20 });

    expect(result.data[0].trackingCode).toBe(
      'ORD-01J8ZQ4C7M3W9X2K5T8R1V6B0P',
    );
    expect(result.data[0].deliveryFee).toBe('0.00');
    expect(result.data[0]).not.toHaveProperty('codAmount');
    expect(result.meta).toEqual({
      page: 1,
      perPage: 20,
      total: 1,
      totalPages: 1,
    });
  });

  it('rejects the rider board request when the authenticated user is not a rider', async () => {
    queryRiders.findFirst.mockResolvedValue(undefined);

    await expect(service.listRiderAssignedOrders('non-rider-user')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('throws NotFoundException for an unknown order', async () => {
    db.select.mockReturnValue(queryChain([]));
    await expect(service.getById(baseOrder().id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns an order with its history', async () => {
    db.select
      .mockReturnValueOnce(queryChain([baseOrder()]))
      .mockReturnValueOnce(queryChain([baseHistory()]));

    const result = await service.getById(baseOrder().id);

    expect(result.status).toBe('PENDING');
    expect(result.history).toHaveLength(1);
    expect(result.history[0].fromStatus).toBeNull();
    expect(result.history[0].toStatus).toBe('PENDING');
  });

  it('creates a PENDING order and initial history in one transaction', async () => {
    queryShops.findFirst.mockResolvedValue({ id: baseOrder().shopId });
    queryCustomers.findFirst.mockResolvedValue({ id: baseOrder().customerId });
    queryTownships.findFirst.mockResolvedValue(undefined);

    const orderInsert = {
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([baseOrder()]),
      }),
    };
    const historyInsert = {
      values: vi.fn().mockResolvedValue(undefined),
    };
    orderState.recordInitialStateInTransaction.mockImplementation(async () => {
      await historyInsert.values({
        orderId: baseOrder().id,
        fromStatus: null,
        toStatus: 'PENDING',
        changedBy: '55555555-5555-4555-8555-555555555555',
      });
    });
    const tx = {
      insert: vi
        .fn()
        .mockReturnValueOnce(orderInsert)
        .mockReturnValueOnce(historyInsert),
    };
    db.transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
    );

    const result = await service.create(
      {
        shopId: baseOrder().shopId,
        customerId: baseOrder().customerId,
      },
      '55555555-5555-4555-8555-555555555555',
    );

    expect(result.status).toBe('PENDING');
    expect(result.trackingCode).toMatch(/^ORD-/);
    const orderValues = orderInsert.values.mock.calls[0][0] as {
      status: string;
      deliveryFee: string;
      commissionFee: string;
    };
    expect(orderValues.status).toBe('PENDING');
    expect(orderValues.deliveryFee).toBe('0');
    expect(orderValues.commissionFee).toBe('0');
    expect(historyInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: baseOrder().id,
        fromStatus: null,
        toStatus: 'PENDING',
      }),
    );
  });

  it('prefills the rider commission from the township default when creating an order', async () => {
    const townshipId = '66666666-6666-4666-8666-666666666666';
    queryShops.findFirst.mockResolvedValue({ id: baseOrder().shopId });
    queryCustomers.findFirst.mockResolvedValue({ id: baseOrder().customerId });
    queryTownships.findFirst.mockResolvedValue({
      id: townshipId,
      name: 'Demo Central',
      defaultDeliveryFee: '3500.00',
      defaultCommissionFee: '500.00',
      leadTimeDays: 2,
      defaultAssigneeType: null,
      defaultRiderId: null,
      defaultPartnerId: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    queryRiders.findFirst.mockResolvedValue({ id: 'rider-1' });
    const assignedOrder = baseOrder({
      status: 'ASSIGNED',
      assigneeType: 'RIDER',
      riderId: 'rider-1',
      deliveryFee: '3500.00',
      commissionFee: '500.00',
    });
    const orderInsert = {
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([assignedOrder]) }),
    };
    const historyInsert = { values: vi.fn().mockResolvedValue(undefined) };
    const transaction = {
      insert: vi.fn().mockReturnValueOnce(orderInsert).mockReturnValueOnce(historyInsert),
    };
    db.transaction.mockImplementation(async (callback: (databaseTransaction: typeof transaction) => Promise<unknown>) => callback(transaction));

    const response = await service.create({
      shopId: baseOrder().shopId,
      customerId: baseOrder().customerId,
      townshipId,
      riderId: 'rider-1',
    }, 'actor-1');

    const orderValues = orderInsert.values.mock.calls[0][0] as {
      deliveryFee: string;
      commissionFee: string;
    };
    expect(orderValues.deliveryFee).toBe('3500.00');
    expect(orderValues.commissionFee).toBe('500.00');
    expect(response.commissionFee).toBe('500.00');
  });

  /** Partner orders are paid through `partnerFee`; they never carry a rider commission. */
  it('never stores a commission on a partner order, even when the township and the body both set one', async () => {
    const townshipId = '66666666-6666-4666-8666-666666666666';
    const partnerId = '77777777-7777-4777-8777-777777777777';
    queryShops.findFirst.mockResolvedValue({ id: baseOrder().shopId });
    queryCustomers.findFirst.mockResolvedValue({ id: baseOrder().customerId });
    queryTownships.findFirst.mockResolvedValue({
      id: townshipId,
      name: 'Demo North',
      defaultDeliveryFee: '4500.00',
      defaultCommissionFee: '700.00',
      leadTimeDays: 2,
      defaultAssigneeType: 'PARTNER',
      defaultRiderId: null,
      defaultPartnerId: partnerId,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    queryDeliveryPartners.findFirst.mockResolvedValue({ id: partnerId, isActive: true });
    const partnerOrder = baseOrder({
      status: 'ASSIGNED',
      assigneeType: 'PARTNER',
      partnerId,
      deliveryFee: '4500.00',
      commissionFee: '0.00',
    });
    const orderInsert = {
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([partnerOrder]) }),
    };
    const historyInsert = { values: vi.fn().mockResolvedValue(undefined) };
    const transaction = {
      insert: vi.fn().mockReturnValueOnce(orderInsert).mockReturnValueOnce(historyInsert),
    };
    db.transaction.mockImplementation(async (callback: (databaseTransaction: typeof transaction) => Promise<unknown>) => callback(transaction));

    const response = await service.create({
      shopId: baseOrder().shopId,
      customerId: baseOrder().customerId,
      townshipId,
      commissionFee: '700.00',
    }, 'actor-1');

    const orderValues = orderInsert.values.mock.calls[0][0] as { commissionFee: string };
    expect(orderValues.commissionFee).toBe('0');
    expect(response.commissionFee).toBe('0.00');
  });

  it.each([
    {
      name: 'a rider to an unassigned order',
      existing: baseOrder(),
      input: { riderId: 'rider-2' },
      expectedRiderId: 'rider-2',
      expectedPartnerId: null,
    },
    {
      name: 'a different rider to an assigned order',
      existing: baseOrder({ status: 'ASSIGNED', assigneeType: 'RIDER', riderId: 'rider-1' }),
      input: { riderId: 'rider-2' },
      expectedRiderId: 'rider-2',
      expectedPartnerId: null,
    },
    {
      name: 'no assignee when the rider is cleared',
      existing: baseOrder({ status: 'ASSIGNED', assigneeType: 'RIDER', riderId: 'rider-1' }),
      input: { riderId: null },
      expectedRiderId: null,
      expectedPartnerId: null,
    },
    {
      name: 'a partner to an unassigned order',
      existing: baseOrder(),
      input: { partnerId: 'partner-1' },
      expectedRiderId: null,
      expectedPartnerId: 'partner-1',
    },
  ])('assigns $name', async ({ existing, input, expectedRiderId, expectedPartnerId }) => {
    queryRiders.findFirst.mockResolvedValue({ id: input.riderId ?? 'rider-2' });
    queryDeliveryPartners.findFirst.mockResolvedValue({ id: 'partner-1' });
    const transaction = {
      select: vi.fn(() => queryChain([existing])),
    };
    db.transaction.mockImplementation(async (callback: (databaseTransaction: typeof transaction) => Promise<unknown>) => callback(transaction));
    const expectedAssigneeType = expectedRiderId ? 'RIDER' : expectedPartnerId ? 'PARTNER' : null;
    const result = baseOrder({
      ...existing,
      status: expectedAssigneeType === null ? 'PENDING' : 'ASSIGNED',
      riderId: expectedRiderId,
      partnerId: expectedPartnerId,
      assigneeType: expectedAssigneeType,
    });
    db.select.mockReturnValue(queryChain([result]));

    await service.assign(existing.id, input, 'actor-1');

    expect(orderState.applyTransitionInTransaction).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        updates: expect.objectContaining({
          assigneeType: expectedAssigneeType,
          riderId: expectedRiderId,
          partnerId: expectedPartnerId,
        }),
      }),
    );
  });

  it('rejects an order for a missing shop or customer', async () => {
    queryShops.findFirst.mockResolvedValue(undefined);
    await expect(
      service.create(
        { shopId: baseOrder().shopId, customerId: baseOrder().customerId },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    queryShops.findFirst.mockResolvedValue({ id: baseOrder().shopId });
    queryCustomers.findFirst.mockResolvedValue(undefined);
    await expect(
      service.create(
        { shopId: baseOrder().shopId, customerId: baseOrder().customerId },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects assigning one order to both a rider and partner', async () => {
    queryShops.findFirst.mockResolvedValue({ id: baseOrder().shopId });
    queryCustomers.findFirst.mockResolvedValue({ id: baseOrder().customerId });

    await expect(service.create({
      shopId: baseOrder().shopId,
      customerId: baseOrder().customerId,
      riderId: '44444444-4444-4444-8444-444444444444',
      partnerId: '55555555-5555-4555-8555-555555555555',
    }, 'actor-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('keeps the same rider assigned when editing township and re-sending that riderId', async () => {
    const riderId = '66666666-6666-4666-8666-666666666666';
    const townshipId = '77777777-7777-4777-8777-777777777777';
    const current = baseOrder({
      townshipId: '88888888-8888-4888-8888-888888888888',
      assigneeType: 'RIDER',
      riderId,
      status: 'ASSIGNED',
    });
    const { auditValues } = prepareUpdateTransaction(current);
    queryTownships.findFirst.mockResolvedValue({ id: townshipId, leadTimeDays: 0, defaultAssigneeType: null });
    queryRiders.findFirst.mockResolvedValue({ id: riderId });

    const result = await service.update(current.id, { townshipId, riderId }, 'actor-1', 'role-1');

    expect(result.status).toBe('ASSIGNED');
    expect(result.riderId).toBe(riderId);
    expect(orderState.applyTransitionInTransaction).not.toHaveBeenCalled();
    expect(auditValues).toHaveBeenCalledWith([
      expect.objectContaining({ field: 'townshipId', oldValue: expect.anything(), newValue: expect.anything() }),
      expect.objectContaining({ field: 'estimatedDeliveryDate', oldValue: expect.anything(), newValue: expect.anything() }),
    ]);
  });

  it('sets the estimated delivery date from the local date when township changes', async () => {
    const townshipId = '77777777-7777-4777-8777-777777777777';
    const current = baseOrder({ townshipId: '88888888-8888-4888-8888-888888888888' });
    queryTownships.findFirst.mockResolvedValue({
      id: townshipId,
      leadTimeDays: 2,
      defaultDeliveryFee: '0.00',
      defaultAssigneeType: null,
      defaultRiderId: null,
      defaultPartnerId: null,
    });
    prepareUpdateTransaction(current);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T17:00:00.000Z'));

    try {
      const result = await service.update(current.id, { townshipId }, 'actor-1', 'role-1');
      expect(result.estimatedDeliveryDate).toBe('2026-10-18');
    } finally {
      vi.useRealTimers();
    }
  });

  it('swaps riders using riderId alone and records only the changed rider field', async () => {
    const previousRiderId = '66666666-6666-4666-8666-666666666666';
    const newRiderId = '77777777-7777-4777-8777-777777777777';
    const current = baseOrder({ assigneeType: 'RIDER', riderId: previousRiderId, status: 'ASSIGNED' });
    const { auditValues } = prepareUpdateTransaction(current);
    queryRiders.findFirst.mockResolvedValue({ id: newRiderId });

    const result = await service.update(current.id, { riderId: newRiderId }, 'actor-1', 'role-1');

    expect(result).toMatchObject({ status: 'ASSIGNED', assigneeType: 'RIDER', riderId: newRiderId, partnerId: null });
    expect(orderState.applyTransitionInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        previousAssignee: { type: 'RIDER', riderId: previousRiderId, partnerId: null },
        newAssignee: { type: 'RIDER', riderId: newRiderId, partnerId: null },
        updates: { assigneeType: 'RIDER', riderId: newRiderId, partnerId: null },
      }),
    );
    const auditRows = auditValues.mock.calls[0]?.[0] as Array<{ field: string }>;
    expect(auditRows.map((row) => row.field)).toEqual(['riderId']);
  });

  it.each([
    {
      description: 'rider to partner',
      current: { assigneeType: 'RIDER', riderId: '66666666-6666-4666-8666-666666666666', partnerId: null },
      input: { partnerId: '77777777-7777-4777-8777-777777777777' },
      result: { assigneeType: 'PARTNER', riderId: null, partnerId: '77777777-7777-4777-8777-777777777777' },
      lookup: 'partner' as const,
    },
    {
      description: 'partner to rider',
      current: { assigneeType: 'PARTNER', riderId: null, partnerId: '66666666-6666-4666-8666-666666666666' },
      input: { riderId: '77777777-7777-4777-8777-777777777777' },
      result: { assigneeType: 'RIDER', riderId: '77777777-7777-4777-8777-777777777777', partnerId: null },
      lookup: 'rider' as const,
    },
  ])('swaps assignment from $description and clears the previous assignee type', async ({ current: assignment, input, result, lookup }) => {
    const current = baseOrder({ ...assignment, status: 'ASSIGNED' });
    prepareUpdateTransaction(current);
    if (lookup === 'rider') queryRiders.findFirst.mockResolvedValue({ id: input.riderId });
    else queryDeliveryPartners.findFirst.mockResolvedValue({ id: input.partnerId, isActive: true });

    const response = await service.update(current.id, input, 'actor-1', 'role-1');

    expect(response).toMatchObject({ status: 'ASSIGNED', ...result });
  });

  it('zeroes the stored commission when an order is reassigned to a partner', async () => {
    const partnerId = '77777777-7777-4777-8777-777777777777';
    const current = baseOrder({
      assigneeType: 'RIDER',
      riderId: '66666666-6666-4666-8666-666666666666',
      partnerId: null,
      commissionFee: '500.00',
      status: 'ASSIGNED',
    });
    prepareUpdateTransaction(current);
    queryDeliveryPartners.findFirst.mockResolvedValue({ id: partnerId, isActive: true });

    const result = await service.update(current.id, { partnerId }, 'actor-1', 'role-1');

    expect(result).toMatchObject({ assigneeType: 'PARTNER', partnerId, commissionFee: '0' });
  });

  it('returns an order to PENDING when its assignee is explicitly cleared', async () => {
    const current = baseOrder({ assigneeType: 'RIDER', riderId: '66666666-6666-4666-8666-666666666666', status: 'ASSIGNED' });
    prepareUpdateTransaction(current);

    const result = await service.update(current.id, { riderId: null }, 'actor-1', 'role-1');

    expect(result).toMatchObject({ status: 'PENDING', assigneeType: null, riderId: null, partnerId: null });
  });

  it('clears the assignee when applying a township with no default and keeps an explicit rider override', async () => {
    const townshipId = '77777777-7777-4777-8777-777777777777';
    const current = baseOrder({
      townshipId: '88888888-8888-4888-8888-888888888888',
      assigneeType: 'RIDER',
      riderId: '66666666-6666-4666-8666-666666666666',
      status: 'ASSIGNED',
    });
    queryTownships.findFirst.mockResolvedValue({ id: townshipId, leadTimeDays: 0, defaultAssigneeType: null, defaultRiderId: null, defaultPartnerId: null });
    prepareUpdateTransaction(current);

    const cleared = await service.update(current.id, { townshipId, applyTownshipAssignee: true }, 'actor-1', 'role-1');
    expect(cleared).toMatchObject({ status: 'PENDING', assigneeType: null, riderId: null, partnerId: null });

    vi.resetAllMocks();
    const secondCurrent = baseOrder({
      townshipId: '88888888-8888-4888-8888-888888888888',
      assigneeType: 'RIDER',
      riderId: '66666666-6666-4666-8666-666666666666',
      status: 'ASSIGNED',
    });
    const explicitRiderId = '99999999-9999-4999-8999-999999999999';
    queryTownships.findFirst.mockResolvedValue({ id: townshipId, leadTimeDays: 0, defaultAssigneeType: null, defaultRiderId: null, defaultPartnerId: null });
    queryRiders.findFirst.mockResolvedValue({ id: explicitRiderId });
    prepareUpdateTransaction(secondCurrent);

    const overridden = await service.update(
      secondCurrent.id,
      { townshipId, applyTownshipAssignee: true, riderId: explicitRiderId },
      'actor-1',
      'role-1',
    );
    expect(overridden).toMatchObject({ status: 'ASSIGNED', assigneeType: 'RIDER', riderId: explicitRiderId, partnerId: null });
  });

  it('does not touch an assigned rider or status when only notes change', async () => {
    const riderId = '66666666-6666-4666-8666-666666666666';
    const current = baseOrder({ assigneeType: 'RIDER', riderId, status: 'ASSIGNED' });
    const { auditValues } = prepareUpdateTransaction(current);

    const result = await service.update(current.id, { notes: 'Updated note' }, 'actor-1', 'role-1');

    expect(result).toMatchObject({ status: 'ASSIGNED', assigneeType: 'RIDER', riderId, notes: 'Updated note' });
    expect(orderState.applyTransitionInTransaction).not.toHaveBeenCalled();
    expect(auditValues).toHaveBeenCalledWith([expect.objectContaining({ field: 'notes' })]);
  });
});
