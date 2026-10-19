import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, desc, eq, gte, ilike, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { DatabaseService } from '../common/database/database.service.js';
import { escapeLikeWildcards } from '../common/utils/normalize.util.js';
import { getDateInTimeZone } from '../common/utils/timezone-date.util.js';
import { riders } from '../riders/rider.schema.js';
import { users } from '../users/user.schema.js';
import type { PaginationMetaDto } from '../users/dto/user-list-response.dto.js';
import { riderBalanceRows } from './handover-balance.util.js';
import type { CreateRiderHandoverDto } from './dto/create-rider-handover.dto.js';
import type { ListRiderHandoversQueryDto } from './dto/list-rider-handovers-query.dto.js';
import type { RiderHandoverBalancesQueryDto } from './dto/rider-handover-balances-query.dto.js';
import type { RiderHandoverAuditResponseDto } from './dto/rider-handover-audit-response.dto.js';
import type { RiderHandoverBalanceListResponseDto } from './dto/rider-handover-balance-list-response.dto.js';
import type { RiderHandoverListResponseDto } from './dto/rider-handover-list-response.dto.js';
import {
  riderHandovers,
  type HandoverMethod,
} from './rider-handover.schema.js';
import type { RiderHandoverBalanceResponseDto, RiderHandoverResponseDto } from './dto/rider-handover-response.dto.js';
import type { UpdateRiderHandoverDto } from './dto/update-rider-handover.dto.js';
import { riderHandoverAudit } from './rider-handover-audit.schema.js';

type HandoverRow = typeof riderHandovers.$inferSelect;

/** The row with both names already resolved by the join. */
type HandoverWithNames = HandoverRow & {
  rider: { user: { name: string } };
  recordedBy: { name: string } | null;
};

/** Everything a correction can move. `id` and the actors deliberately cannot. */
interface HandoverFields {
  riderId: string;
  amount: string;
  receivedOn: string;
  method: HandoverMethod;
  note: string | null;
}

const AUDITED_FIELDS = [
  'riderId',
  'amount',
  'receivedOn',
  'method',
  'note',
] as const satisfies readonly (keyof HandoverFields)[];

type AuditedField = (typeof AUDITED_FIELDS)[number];

/**
 * Every handover field is text on the wire, so the history stores text. A bare
 * jsonb of an amount would go in as a JSON number and come back without its
 * scale — the same reason the order audit keeps its money fields as strings.
 */
function auditJson(value: string | null): SQL {
  return value === null ? sql`'null'::jsonb` : sql`to_jsonb(${value}::text)`;
}

/**
 * `12000` and `12000.00` are one amount. Without this, re-typing the same figure
 * without its decimals would write a history row claiming a change that did not
 * happen — and the balances page would look like it had a correction it never had.
 */
function normalizeAmount(value: string): string {
  const [whole, fraction = ''] = value.split('.');
  return `${whole}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}

/** An emptied note field clears the note rather than storing whitespace. */
function normalizeNote(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function sameFieldValue(
  field: AuditedField,
  current: string | null,
  next: string | null,
): boolean {
  if (current === null || next === null) return current === next;
  return field === 'amount'
    ? normalizeAmount(current) === normalizeAmount(next)
    : current === next;
}

export function toHandoverResponse(
  row: HandoverRow,
  riderName: string,
  recordedByName: string | null,
): RiderHandoverResponseDto {
  return {
    id: row.id,
    riderId: row.riderId,
    riderName,
    amount: row.amount,
    receivedOn: row.receivedOn,
    method: row.method,
    note: row.note,
    recordedByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class RiderHandoversService {
  private readonly timeZone: string;

  constructor(
    private readonly database: DatabaseService,
    config: ConfigService,
  ) {
    this.timeZone = config.get<string>('APP_TIMEZONE') ?? 'Asia/Yangon';
  }

  async list(query: ListRiderHandoversQueryDto): Promise<RiderHandoverListResponseDto> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 50;

    const conditions: SQL[] = [];
    if (query.riderId) conditions.push(eq(riderHandovers.riderId, query.riderId));
    if (query.method) conditions.push(eq(riderHandovers.method, query.method));
    /** `received_on` is already a date: the officer's day, not a bucketed instant. */
    if (query.dateFrom) conditions.push(gte(riderHandovers.receivedOn, query.dateFrom));
    if (query.dateTo) conditions.push(lte(riderHandovers.receivedOn, query.dateTo));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      this.database.db.query.riderHandovers.findMany({
        where,
        with: {
          rider: { columns: { id: true }, with: { user: { columns: { name: true } } } },
          recordedBy: { columns: { name: true } },
        },
        orderBy: [desc(riderHandovers.receivedOn), desc(riderHandovers.createdAt)],
        limit: perPage,
        offset: (page - 1) * perPage,
      }),
      this.database.db.select({ count: sql<number>`count(*)` }).from(riderHandovers).where(where),
    ]);

    const total = Number(countResult[0]?.count ?? 0);
    return {
      data: rows.map((row) =>
        toHandoverResponse(row, row.rider.user.name, row.recordedBy?.name ?? null),
      ),
      meta: paginationMeta(page, perPage, total),
    };
  }

  /**
   * Balances are **riders-driven**: every rider appears, with or without
   * deliveries, active or deactivated, because a rider who has handed money in
   * and a rider who still owes both belong on this page. That is why the
   * `rider-collection` report could not be reused as a template — it is
   * orders-driven with an inner join and would silently drop them.
   *
   * The row shape, the balance formula and its aliases live in
   * `riderBalanceRows`; this method only filters, pages and orders it.
   */
  async listBalances(
    query: RiderHandoverBalancesQueryDto,
  ): Promise<RiderHandoverBalanceListResponseDto> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 50;

    const balances = riderBalanceRows(this.database.db, this.timeZone);

    const conditions: SQL[] = [];
    const search = query.search?.trim();
    if (search) {
      conditions.push(ilike(balances.riderName, `%${escapeLikeWildcards(search)}%`));
    }
    /** `<> 0` rather than `> 0`: a negative balance is a mistake to fix, so it
     * must not be filtered out of sight — it is exactly what needs looking at. */
    if (query.outstandingOnly) conditions.push(sql`${balances.balance}::numeric <> 0`);
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      this.database.db
        .select()
        .from(balances)
        .where(where)
        /** By name, so paging through the list cannot reorder under the officer. */
        .orderBy(asc(balances.riderName))
        .limit(perPage)
        .offset((page - 1) * perPage),
      this.database.db.select({ count: sql<number>`count(*)` }).from(balances).where(where),
    ]);

    const total = Number(countResult[0]?.count ?? 0);
    const data: RiderHandoverBalanceResponseDto[] = rows.map((row) => ({
      riderId: row.riderId,
      riderName: row.riderName,
      riderStatus: row.riderStatus,
      deliveredCod: row.deliveredCod,
      accepted: row.accepted,
      balance: row.balance,
      lastReceivedOn: row.lastReceivedOn,
      oldestUnsettledDeliveredOn: row.oldestUnsettledDeliveredOn,
    }));

    return { data, meta: paginationMeta(page, perPage, total) };
  }

  async create(
    input: CreateRiderHandoverDto,
    actorId: string,
  ): Promise<RiderHandoverResponseDto> {
    const riderName = await this.riderNameOrThrow(input.riderId);
    this.assertNotFuture(input.receivedOn);

    const [row] = await this.database.db
      .insert(riderHandovers)
      .values({
        riderId: input.riderId,
        amount: input.amount,
        receivedOn: input.receivedOn,
        method: input.method,
        note: normalizeNote(input.note),
        recordedBy: actorId,
      })
      .returning();
    if (!row) throw new NotFoundException('The recorded handover could not be read back');

    return toHandoverResponse(row, riderName, await this.actorName(actorId));
  }

  /**
   * A correction is an edit in place: the row keeps its identity and every
   * changed field leaves a history row behind. Nothing is deleted, and an edit
   * that changes nothing is refused rather than writing an empty history entry.
   */
  async update(
    id: string,
    input: UpdateRiderHandoverDto,
    actorId: string,
  ): Promise<RiderHandoverResponseDto> {
    const current = await this.handoverOrThrow(id);

    if (input.receivedOn !== undefined) this.assertNotFuture(input.receivedOn);
    if (input.riderId !== undefined && input.riderId !== current.riderId) {
      await this.riderNameOrThrow(input.riderId);
    }

    const candidate: HandoverFields = {
      riderId: input.riderId ?? current.riderId,
      amount: input.amount ?? current.amount,
      receivedOn: input.receivedOn ?? current.receivedOn,
      method: input.method ?? current.method,
      note: input.note === undefined ? current.note : normalizeNote(input.note),
    };

    const changed = AUDITED_FIELDS.filter(
      (field) => !sameFieldValue(field, current[field], candidate[field]),
    );
    if (changed.length === 0) {
      throw new BadRequestException(
        'Nothing changed — edit a field, or discard the correction',
      );
    }

    await this.database.db.transaction(async (transaction) => {
      await transaction
        .update(riderHandovers)
        .set({ ...candidate, updatedAt: new Date() })
        .where(eq(riderHandovers.id, id));
      await transaction.insert(riderHandoverAudit).values(
        changed.map((field) => ({
          handoverId: id,
          field,
          oldValue: auditJson(current[field]),
          newValue: auditJson(candidate[field]),
          actorId,
          reason: input.reason,
        })),
      );
    });

    const updated = await this.handoverOrThrow(id);
    return toHandoverResponse(
      updated,
      updated.rider.user.name,
      updated.recordedBy?.name ?? null,
    );
  }

  async getAudit(id: string): Promise<RiderHandoverAuditResponseDto[]> {
    await this.handoverOrThrow(id);

    const rows = await this.database.db.query.riderHandoverAudit.findMany({
      where: eq(riderHandoverAudit.handoverId, id),
      /**
       * Oldest first, the same chronological order as `GET /orders/:id/audit`:
       * a trail reads downward through time, so the newest correction is the
       * last line rather than the first.
       */
      orderBy: [asc(riderHandoverAudit.createdAt)],
      with: { actor: { columns: { name: true } } },
    });

    const entries: RiderHandoverAuditResponseDto[] = rows.map((row) => ({
      id: row.id,
      handoverId: row.handoverId,
      field: row.field,
      oldValue: row.oldValue ?? null,
      newValue: row.newValue ?? null,
      actorId: row.actorId,
      actorName: row.actor?.name ?? null,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    }));

    return this.withResolvedRiders(entries);
  }

  /**
   * The one identifier-valued field reads as a name, the way the order audit
   * resolves its ids — an office view must never print a uuid.
   */
  private async withResolvedRiders(
    entries: RiderHandoverAuditResponseDto[],
  ): Promise<RiderHandoverAuditResponseDto[]> {
    const ids = new Set<string>();
    for (const entry of entries) {
      if (entry.field !== 'riderId') continue;
      for (const value of [entry.oldValue, entry.newValue]) {
        if (typeof value === 'string') ids.add(value);
      }
    }
    if (ids.size === 0) return entries;

    const rows = await this.database.db.query.riders.findMany({
      where: inArray(riders.id, [...ids]),
      columns: { id: true },
      with: { user: { columns: { name: true } } },
    });
    const names = new Map(rows.map((row) => [row.id, row.user.name]));
    const resolve = (value: unknown): unknown =>
      typeof value === 'string' ? (names.get(value) ?? 'Unknown') : value;

    return entries.map((entry) =>
      entry.field === 'riderId'
        ? { ...entry, oldValue: resolve(entry.oldValue), newValue: resolve(entry.newValue) }
        : entry,
    );
  }

  private async handoverOrThrow(id: string): Promise<HandoverWithNames> {
    const row = await this.database.db.query.riderHandovers.findFirst({
      where: eq(riderHandovers.id, id),
      with: {
        rider: { columns: { id: true }, with: { user: { columns: { name: true } } } },
        recordedBy: { columns: { name: true } },
      },
    });
    if (!row) throw new NotFoundException(`Handover '${id}' not found`);
    return row;
  }

  private async riderNameOrThrow(riderId: string): Promise<string> {
    const rider = await this.database.db.query.riders.findFirst({
      where: eq(riders.id, riderId),
      columns: { id: true },
      with: { user: { columns: { name: true } } },
    });
    if (!rider) throw new NotFoundException(`Rider '${riderId}' not found`);
    return rider.user.name;
  }

  private async actorName(actorId: string): Promise<string | null> {
    const actor = await this.database.db.query.users.findFirst({
      where: eq(users.id, actorId),
      columns: { name: true },
    });
    return actor?.name ?? null;
  }

  /**
   * The date is compared in the API timezone, not UTC: Yangon is ahead of UTC,
   * so a handover accepted this morning would otherwise be refused for being
   * "tomorrow" between midnight and 06:30 local time.
   */
  private assertNotFuture(receivedOn: string): void {
    const today = getDateInTimeZone(new Date(), this.timeZone);
    if (receivedOn > today) {
      throw new BadRequestException(`The received date cannot be after today (${today})`);
    }
  }
}

function paginationMeta(page: number, perPage: number, total: number): PaginationMetaDto {
  return { page, perPage, total, totalPages: Math.ceil(total / perPage) };
}
