import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DatabaseService } from '../common/database/database.service.js';
import { TownshipsService } from './townships.service.js';

function baseTownship(overrides: Record<string, unknown> = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Demo Central',
    defaultDeliveryFee: '3500.00',
    leadTimeDays: 3,
    defaultAssigneeType: null,
    defaultRiderId: null,
    defaultPartnerId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('TownshipsService', () => {
  let service: TownshipsService;

  const queryTownships = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  };
  const db = {
    query: {
      townships: queryTownships,
      riders: { findFirst: vi.fn() },
      deliveryPartners: { findFirst: vi.fn() },
    },
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const database = { db };

  beforeEach(async () => {
    vi.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        TownshipsService,
        { provide: DatabaseService, useValue: database },
      ],
    }).compile();
    service = moduleRef.get(TownshipsService);
  });

  /** The delete guard counts orders referencing the township. */
  function mockOrderReferenceCount(count: number) {
    db.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ c: count }]),
      }),
    });
  }

  it('creates a township and stores the lead time the DTO requires', async () => {
    db.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([baseTownship()]),
      }),
    });

    const result = await service.create({
      name: ' Demo Central ',
      defaultDeliveryFee: '3500.00',
      leadTimeDays: 3,
    });

    expect(result.id).toBe(baseTownship().id);
    expect(db.insert.mock.results[0].value.values).toHaveBeenCalledWith({
      name: 'Demo Central',
      defaultDeliveryFee: '3500.00',
      leadTimeDays: 3,
      defaultAssigneeType: null,
      defaultRiderId: null,
      defaultPartnerId: null,
    });
  });

  it('throws NotFoundException for an unknown township', async () => {
    queryTownships.findFirst.mockResolvedValue(undefined);

    await expect(service.getById('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('deletes a township that no order references', async () => {
    queryTownships.findFirst.mockResolvedValue(baseTownship());
    mockOrderReferenceCount(0);
    db.delete.mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });

    await expect(service.remove(baseTownship().id)).resolves.toBeUndefined();
    expect(db.delete).toHaveBeenCalled();
  });

  it('refuses to delete a township an order still references', async () => {
    queryTownships.findFirst.mockResolvedValue(baseTownship());
    mockOrderReferenceCount(2);

    await expect(service.remove(baseTownship().id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(db.delete).not.toHaveBeenCalled();
  });
});
