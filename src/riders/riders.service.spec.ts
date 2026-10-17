import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DatabaseService } from '../common/database/database.service.js';
import { RidersService } from './riders.service.js';
import { PermissionService } from '../permissions/permissions.service.js';

function baseRider(overrides: Record<string, unknown> = {}) {
  return {
    riderId: '44444444-4444-4444-8444-444444444444',
    userId: '55555555-5555-4555-8555-555555555555',
    name: 'John Rider',
    email: 'john.rider@delivery.local',
    phone: '09123456789',
    status: 'ACTIVE' as const,
    vehicleType: 'BIKE' as const,
    vehiclePlate: null,
    licenseNo: null,
    nrcNumber: null,
    emergencyContactPhone: null,
    notes: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function queryChain(result: unknown) {
  const chain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(result).then(resolve),
  };
  chain.from.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.offset.mockReturnValue(chain);
  return chain;
}

describe('RidersService', () => {
  let service: RidersService;

  const queryRoles = { findFirst: vi.fn() };
  const db = {
    query: { roles: queryRoles },
    select: vi.fn(),
    transaction: vi.fn(),
  };
  const database = { db };
  const permissions = { getEffectivePermissions: vi.fn().mockResolvedValue([]) };

  beforeEach(async () => {
    vi.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        RidersService,
        { provide: DatabaseService, useValue: database },
        { provide: PermissionService, useValue: permissions },
      ],
    }).compile();
    service = moduleRef.get(RidersService);
  });

  it('lists riders with pagination metadata', async () => {
    const dataQuery = queryChain([baseRider()]);
    const countQuery = queryChain([{ count: 1 }]);
    db.select.mockReturnValueOnce(dataQuery).mockReturnValueOnce(countQuery);

    const result = await service.list({ page: 1, perPage: 20 });

    expect(result.data[0].email).toBe('john.rider@delivery.local');
    expect(result.meta).toEqual({
      page: 1,
      perPage: 20,
      total: 1,
      totalPages: 1,
    });
  });

  it('throws NotFoundException for an unknown rider', async () => {
    db.select.mockReturnValue(queryChain([]));
    await expect(service.getById('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('creates the user and rider in one transaction', async () => {
    queryRoles.findFirst.mockResolvedValue({ id: 'r-rider' });
    const userInsert = {
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: baseRider().userId }]),
      }),
    };
    const riderInsert = {
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: baseRider().riderId }]),
      }),
    };
    const tx = {
      insert: vi.fn().mockReturnValueOnce(userInsert).mockReturnValueOnce(riderInsert),
    };
    db.transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<string>) =>
        callback(tx),
    );
    db.select.mockReturnValue(queryChain([baseRider()]));

    const result = await service.create({
      name: ' John Rider ',
      email: 'John.Rider@Delivery.Local',
      password: 'password1',
    });

    expect(result.id).toBe(baseRider().riderId);
    expect(tx.insert).toHaveBeenCalledTimes(2);
    expect(userInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'John Rider',
        email: 'john.rider@delivery.local',
        roleId: 'r-rider',
        status: 'ACTIVE',
      }),
    );
    expect(riderInsert.values).toHaveBeenCalledWith({
      userId: baseRider().userId,
      vehicleType: 'BIKE',
      vehiclePlate: null,
      licenseNo: null,
      nrcNumber: null,
      emergencyContactPhone: null,
      notes: null,
    });
  });

  it('maps duplicate rider email to ConflictException', async () => {
    queryRoles.findFirst.mockResolvedValue({ id: 'r-rider' });
    const tx = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockRejectedValue({ code: '23505' }),
        }),
      }),
    };
    db.transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<string>) =>
        callback(tx),
    );

    await expect(
      service.create({
        name: 'John Rider',
        email: 'john.rider@delivery.local',
        password: 'password1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('updates and deletes the rider account transactionally', async () => {
    const existing = baseRider();
    db.select.mockReturnValueOnce(queryChain([existing]));
    const tx = {
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    };
    db.transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<void>) =>
        callback(tx),
    );
    db.select.mockReturnValueOnce(queryChain([baseRider({ name: 'Updated' })]));

    const updated = await service.update(existing.riderId, { name: 'Updated' });
    expect(updated.name).toBe('Updated');

    db.select.mockReturnValueOnce(queryChain([existing]));
    await expect(service.remove(existing.riderId)).resolves.toBeUndefined();
    expect(tx.delete).toHaveBeenCalled();
  });
});
