import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DatabaseService } from '../common/database/database.service.js';
import { getDateInTimeZone } from '../common/utils/timezone-date.util.js';
import { RiderHandoversService } from './rider-handovers.service.js';

const HANDOVER_ID = '11111111-1111-4111-8111-111111111111';
const RIDER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_RIDER_ID = '33333333-3333-4333-8333-333333333333';
const ACTOR_ID = '44444444-4444-4444-8444-444444444444';

const TIME_ZONE = 'Asia/Yangon';

/**
 * Far enough away in both directions that the clock cannot make these unstable:
 * the guard is "not after today in the API timezone", never a range check.
 */
const LONG_PAST = '2020-01-01';
const FAR_FUTURE = '2099-01-01';

function baseHandover(overrides: Record<string, unknown> = {}) {
  return {
    id: HANDOVER_ID,
    riderId: RIDER_ID,
    amount: '12000.00',
    receivedOn: LONG_PAST,
    method: 'KPAY',
    note: null,
    recordedBy: ACTOR_ID,
    createdAt: new Date('2026-10-20T03:00:00.000Z'),
    updatedAt: new Date('2026-10-20T03:00:00.000Z'),
    ...overrides,
  };
}

/** A row as the joined reads return it: the handover plus both resolved names. */
function joinedHandover(overrides: Record<string, unknown> = {}) {
  return {
    ...baseHandover(overrides),
    rider: { user: { name: 'Aung Aung' } },
    recordedBy: { name: 'Officer One' },
  };
}

describe('RiderHandoversService', () => {
  let service: RiderHandoversService;

  const queryRiders = { findFirst: vi.fn(), findMany: vi.fn() };
  const queryUsers = { findFirst: vi.fn() };
  const queryHandovers = { findFirst: vi.fn(), findMany: vi.fn() };
  const queryAudit = { findMany: vi.fn() };

  const insertReturning = vi.fn();
  const insertValues = vi.fn();
  const transactionInsertValues = vi.fn();
  const transactionUpdateSet = vi.fn();
  const transactionUpdateWhere = vi.fn();

  const db = {
    query: {
      riders: queryRiders,
      users: queryUsers,
      riderHandovers: queryHandovers,
      riderHandoverAudit: queryAudit,
    },
    insert: vi.fn(),
    select: vi.fn(),
    transaction: vi.fn(),
  };
  const database = { db };

  beforeEach(async () => {
    vi.resetAllMocks();

    db.insert.mockReturnValue({
      values: insertValues.mockReturnValue({ returning: insertReturning }),
    });
    db.transaction.mockImplementation(
      async (callback: (transaction: unknown) => Promise<unknown>) =>
        callback({
          update: () => ({ set: transactionUpdateSet.mockReturnValue({ where: transactionUpdateWhere }) }),
          insert: () => ({ values: transactionInsertValues }),
        }),
    );
    queryRiders.findFirst.mockResolvedValue({ user: { name: 'Aung Aung' } });
    queryUsers.findFirst.mockResolvedValue({ name: 'Officer One' });
    insertReturning.mockResolvedValue([baseHandover()]);
    transactionUpdateWhere.mockResolvedValue(undefined);
    transactionInsertValues.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        RiderHandoversService,
        { provide: DatabaseService, useValue: database },
        { provide: ConfigService, useValue: { get: () => TIME_ZONE } },
      ],
    }).compile();
    service = moduleRef.get(RiderHandoversService);
  });

  describe('create', () => {
    it('refuses a rider that does not exist', async () => {
      queryRiders.findFirst.mockResolvedValue(undefined);

      await expect(
        service.create(
          { riderId: RIDER_ID, amount: '12000.00', receivedOn: LONG_PAST, method: 'KPAY' },
          ACTOR_ID,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('refuses a received date in the future', async () => {
      await expect(
        service.create(
          { riderId: RIDER_ID, amount: '12000.00', receivedOn: FAR_FUTURE, method: 'KPAY' },
          ACTOR_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('accepts today in the API timezone, which is ahead of UTC', async () => {
      const today = getDateInTimeZone(new Date(), TIME_ZONE);
      insertReturning.mockResolvedValue([baseHandover({ receivedOn: today })]);

      await expect(
        service.create(
          { riderId: RIDER_ID, amount: '12000.00', receivedOn: today, method: 'KPAY' },
          ACTOR_ID,
        ),
      ).resolves.toMatchObject({ receivedOn: today });
    });

    it('resolves both names and passes the amount through untouched', async () => {
      insertReturning.mockResolvedValue([baseHandover({ amount: '12000.50' })]);

      const result = await service.create(
        { riderId: RIDER_ID, amount: '12000.50', receivedOn: LONG_PAST, method: 'KPAY' },
        ACTOR_ID,
      );

      expect(result.riderName).toBe('Aung Aung');
      expect(result.recordedByName).toBe('Officer One');
      /** Not `Number(...)`, not `toFixed` — the decimal string Postgres stored. */
      expect(result.amount).toBe('12000.50');
    });

    it('stores an empty note as null rather than an empty string', async () => {
      await service.create(
        { riderId: RIDER_ID, amount: '12000.00', receivedOn: LONG_PAST, method: 'KPAY', note: '   ' },
        ACTOR_ID,
      );

      expect(insertValues).toHaveBeenCalledWith(
        expect.objectContaining({ note: null, recordedBy: ACTOR_ID }),
      );
    });
  });

  describe('update', () => {
    it('refuses an edit that changes nothing instead of writing an empty history', async () => {
      queryHandovers.findFirst.mockResolvedValue(joinedHandover());

      await expect(
        service.update(
          HANDOVER_ID,
          { amount: '12000.00', method: 'KPAY', reason: 'checking' },
          ACTOR_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    /** `12000` and `12000.00` are the same amount — the audit must not claim a change. */
    it('treats a differently-written but equal amount as unchanged', async () => {
      queryHandovers.findFirst.mockResolvedValue(joinedHandover({ amount: '12000.00' }));

      await expect(
        service.update(HANDOVER_ID, { amount: '12000', reason: 'checking' }, ACTOR_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('writes one history row per changed field, with the actor and the reason', async () => {
      queryHandovers.findFirst
        .mockResolvedValueOnce(joinedHandover({ amount: '12000.00', method: 'KPAY' }))
        .mockResolvedValueOnce(joinedHandover({ amount: '5000.00', method: 'CASH' }));

      const result = await service.update(
        HANDOVER_ID,
        { amount: '5000.00', method: 'CASH', reason: 'transfer reversed in part' },
        ACTOR_ID,
      );

      expect(transactionUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ amount: '5000.00', method: 'CASH' }),
      );
      const history = transactionInsertValues.mock.calls[0]?.[0] as unknown[];
      expect(history).toHaveLength(2);
      expect(history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ handoverId: HANDOVER_ID, field: 'amount', actorId: ACTOR_ID, reason: 'transfer reversed in part' }),
          expect.objectContaining({ handoverId: HANDOVER_ID, field: 'method', actorId: ACTOR_ID, reason: 'transfer reversed in part' }),
        ]),
      );
      expect(result.amount).toBe('5000.00');
    });

    it('refuses to move a handover onto a rider that does not exist', async () => {
      queryHandovers.findFirst.mockResolvedValue(joinedHandover());
      queryRiders.findFirst.mockResolvedValue(undefined);

      await expect(
        service.update(HANDOVER_ID, { riderId: OTHER_RIDER_ID, reason: 'wrong rider' }, ACTOR_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('refuses an edit to a future received date', async () => {
      queryHandovers.findFirst.mockResolvedValue(joinedHandover());

      await expect(
        service.update(HANDOVER_ID, { receivedOn: FAR_FUTURE, reason: 'typo' }, ACTOR_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.transaction).not.toHaveBeenCalled();
    });
  });

  describe('getAudit', () => {
    it('reads a rider change as two names, never as two ids', async () => {
      queryHandovers.findFirst.mockResolvedValue(baseHandover());
      queryAudit.findMany.mockResolvedValue([
        {
          id: 'audit-1',
          handoverId: HANDOVER_ID,
          field: 'riderId',
          oldValue: RIDER_ID,
          newValue: OTHER_RIDER_ID,
          actorId: ACTOR_ID,
          actor: { name: 'Officer One' },
          reason: 'wrong rider',
          createdAt: new Date('2026-10-20T04:00:00.000Z'),
        },
      ]);
      queryRiders.findMany.mockResolvedValue([
        { id: RIDER_ID, user: { name: 'Aung Aung' } },
        { id: OTHER_RIDER_ID, user: { name: 'Kyaw Kyaw' } },
      ]);

      const [entry] = await service.getAudit(HANDOVER_ID);

      expect(entry.oldValue).toBe('Aung Aung');
      expect(entry.newValue).toBe('Kyaw Kyaw');
      expect(entry.actorName).toBe('Officer One');
      expect(entry.reason).toBe('wrong rider');
    });

    it('marks a rider that no longer exists rather than showing nothing', async () => {
      queryHandovers.findFirst.mockResolvedValue(baseHandover());
      queryAudit.findMany.mockResolvedValue([
        {
          id: 'audit-2',
          handoverId: HANDOVER_ID,
          field: 'riderId',
          oldValue: RIDER_ID,
          newValue: OTHER_RIDER_ID,
          actorId: null,
          actor: null,
          reason: 'wrong rider',
          createdAt: new Date('2026-10-20T04:00:00.000Z'),
        },
      ]);
      queryRiders.findMany.mockResolvedValue([{ id: RIDER_ID, user: { name: 'Aung Aung' } }]);

      const [entry] = await service.getAudit(HANDOVER_ID);

      expect(entry.oldValue).toBe('Aung Aung');
      expect(entry.newValue).toBe('Unknown');
      expect(entry.actorName).toBeNull();
    });

    it('leaves non-identifier values alone', async () => {
      queryHandovers.findFirst.mockResolvedValue(baseHandover());
      queryAudit.findMany.mockResolvedValue([
        {
          id: 'audit-3',
          handoverId: HANDOVER_ID,
          field: 'amount',
          oldValue: '12000.00',
          newValue: '0.00',
          actorId: ACTOR_ID,
          actor: { name: 'Officer One' },
          reason: 'duplicate of the 14th',
          createdAt: new Date('2026-10-20T04:00:00.000Z'),
        },
      ]);

      const [entry] = await service.getAudit(HANDOVER_ID);

      expect(entry.oldValue).toBe('12000.00');
      expect(entry.newValue).toBe('0.00');
      expect(queryRiders.findMany).not.toHaveBeenCalled();
    });
  });
});
