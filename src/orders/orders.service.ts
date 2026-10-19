import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  and,
  asc,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { PermissionService } from '../permissions/permissions.service.js';
import { DatabaseService } from '../common/database/database.service.js';
import { isUniqueViolation } from '../common/database/is-unique-violation.js';
import { escapeLikeWildcards } from '../common/utils/normalize.util.js';
import { getDateInTimeZone } from '../common/utils/timezone-date.util.js';
import { customers } from '../customers/customer.schema.js';
import { deliveryPartners } from '../delivery-partners/delivery-partner.schema.js';
import { riders } from '../riders/rider.schema.js';
import { RiderDeliveredResponseDto } from '../riders/dto/rider-delivered-response.dto.js';
import { RiderOrderResponseDto } from '../riders/dto/rider-order-response.dto.js';
import { calculateCodToCollect } from '../riders/rider-order-money.util.js';
import { shops } from '../shops/shop.schema.js';
import { townships } from '../townships/township.schema.js';
import { users } from '../users/user.schema.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { AssignOrderDto } from './dto/assign-order.dto.js';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto.js';
import { OrderDetailResponseDto } from './dto/order-detail-response.dto.js';
import { OrderFieldAuditResponseDto } from './dto/order-field-audit-response.dto.js';
import { OrderHistoryResponseDto } from './dto/order-history-response.dto.js';
import { OrderListResponseDto } from './dto/order-list-response.dto.js';
import { OrderReasonDto } from './dto/order-reason.dto.js';
import { OrderResponseDto } from './dto/order-response.dto.js';
import { SendBackOrderDto } from './dto/send-back-order.dto.js';
import { ShopAdvanceDto } from './dto/shop-advance.dto.js';
import { UpdateOrderDto } from './dto/update-order.dto.js';
import { orderFieldAudit } from './order-field-audit.schema.js';
import { OrderStateService } from './order-state.service.js';
import { orderStatusHistory } from './order-status-history.schema.js';
import {
  orders,
  type AssigneeSnapshot,
  type AssigneeType,
  type OrderStatus,
} from './order.schema.js';
import { generateTrackingCode } from './tracking-code.util.js';

const MAX_TRACKING_CODE_ATTEMPTS = 3;
/**
 * Fields whose value is money and must keep its decimal string through audit
 * serialisation. `shopAdvanceAmount` is not editable through `PATCH /orders/:id`
 * — it is written only by the shop-advance endpoints — but it belongs here so a
 * future edit path cannot silently stringify it as a number.
 */
const MONEY_FIELDS = [
  'packagePrice',
  'deliveryFee',
  'isPackagePaidToShop',
  'isFeePaidToShop',
  'partnerFee',
  'commissionFee',
  'shopAdvanceAmount',
] as const;

type OrderRow = typeof orders.$inferSelect;
type OrderHistoryRow = typeof orderStatusHistory.$inferSelect;
type OrderHistoryRowWithActor = OrderHistoryRow & {
  changedByName: string | null;
};

/**
 * Audited fields whose value is a reference to another record. The raw id is
 * meaningless to an office reader — and an officer holds `orders.read` without
 * `shops.read` / `customers.read` / `riders.read`, so a client cannot resolve
 * it — which is why `getAudit` swaps these for the referenced record's name.
 */
const AUDIT_IDENTIFIER_FIELDS = [
  'shopId',
  'customerId',
  'townshipId',
  'riderId',
  'partnerId',
] as const;

type AuditIdentifierField = (typeof AUDIT_IDENTIFIER_FIELDS)[number];

function isAuditIdentifierField(
  field: string,
): field is AuditIdentifierField {
  return (AUDIT_IDENTIFIER_FIELDS as readonly string[]).includes(field);
}
type OrderChanges = Partial<Omit<typeof orders.$inferInsert, 'id' | 'trackingCode' | 'status' | 'createdAt'>>;
type AssigneeSelection = {
  type: AssigneeType | null;
  riderId: string | null;
  partnerId: string | null;
};

export function toOrderResponse(row: OrderRow, timeZone = 'Asia/Yangon'): OrderResponseDto {
  return {
    id: row.id,
    trackingCode: row.trackingCode,
    shopId: row.shopId,
    customerId: row.customerId,
    townshipId: row.townshipId,
    assigneeType: row.assigneeType,
    riderId: row.riderId,
    partnerId: row.partnerId,
    partnerTrackingNo: row.partnerTrackingNo,
    packageInfo: row.packageInfo as Record<string, unknown> | null,
    packagePrice: row.packagePrice,
    deliveryFee: row.deliveryFee,
    isPackagePaidToShop: row.isPackagePaidToShop,
    isFeePaidToShop: row.isFeePaidToShop,
    partnerFee: row.partnerFee,
    commissionFee: row.commissionFee,
    shopAdvanceAmount: row.shopAdvanceAmount,
    shopAdvancedAt: row.shopAdvancedAt?.toISOString() ?? null,
    estimatedDeliveryDate: row.estimatedDeliveryDate ? getDateInTimeZone(row.estimatedDeliveryDate, timeZone) : null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    deliveryAddress: row.deliveryAddress,
    cancelReason: row.cancelReason,
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toOrderHistoryResponse(
  row: OrderHistoryRowWithActor,
): OrderHistoryResponseDto {
  return {
    id: row.id,
    orderId: row.orderId,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    changedBy: row.changedBy,
    changedByName: row.changedByName,
    note: row.note,
    reason: row.reason,
    internalNote: row.internalNote,
    previousAssignee: row.previousAssignee,
    newAssignee: row.newAssignee,
    createdAt: row.createdAt.toISOString(),
  };
}

function toAssigneeSnapshot(row: Pick<OrderRow, 'assigneeType' | 'riderId' | 'partnerId'>): AssigneeSnapshot | null {
  if (row.assigneeType === null) return null;
  return { type: row.assigneeType, riderId: row.riderId, partnerId: row.partnerId };
}

function selectionToSnapshot(selection: AssigneeSelection): AssigneeSnapshot | null {
  if (selection.type === null) return null;
  return { type: selection.type, riderId: selection.riderId, partnerId: selection.partnerId };
}

function dateFromString(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

function dateToString(value: Date | string | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : dateFromString(value);
}

function sameValue(first: unknown, second: unknown): boolean {
  if (first instanceof Date && second instanceof Date) return first.getTime() === second.getTime();
  if (first === second) return true;
  if (first !== null && second !== null && typeof first === 'object' && typeof second === 'object') {
    return JSON.stringify(first) === JSON.stringify(second);
  }
  return false;
}

function toAuditJson(value: unknown, preserveDecimalString: boolean): SQL {
  if (preserveDecimalString) return sql`to_jsonb(${String(value)}::text)`;
  if (value === null) return sql`'null'::jsonb`;
  if (typeof value === 'string') return sql`to_jsonb(${value}::text)`;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new BadRequestException('Order field cannot be serialized for audit');
  return sql`${serialized}::jsonb`;
}

@Injectable()
export class OrdersService {
  private readonly timeZone: string;

  constructor(
    private readonly database: DatabaseService,
    private readonly orderState: OrderStateService,
    private readonly permissions: PermissionService,
    config: ConfigService,
  ) {
    this.timeZone = config.get<string>('APP_TIMEZONE') ?? 'Asia/Yangon';
  }

  async list(query: ListOrdersQueryDto): Promise<OrderListResponseDto> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const conditions: SQL[] = [];

    if (query.search?.trim()) {
      const search = `%${escapeLikeWildcards(query.search.trim())}%`;
      const customerMatches = exists(
        this.database.db.select({ id: customers.id }).from(customers).where(
          and(
            eq(customers.id, orders.customerId),
            or(ilike(customers.name, search), ilike(customers.phone, search), ilike(customers.address, search)),
          ),
        ),
      );
      conditions.push(or(
        ilike(orders.trackingCode, search),
        ilike(orders.deliveryAddress, search),
        customerMatches,
      ) as SQL);
    }
    if (query.status) conditions.push(eq(orders.status, query.status));
    if (query.shopId) conditions.push(eq(orders.shopId, query.shopId));
    if (query.townshipId) conditions.push(eq(orders.townshipId, query.townshipId));
    if (query.assigneeId) {
      conditions.push(or(eq(orders.riderId, query.assigneeId), eq(orders.partnerId, query.assigneeId)) as SQL);
    }
    if (query.isPackagePaidToShop !== undefined) {
      conditions.push(eq(orders.isPackagePaidToShop, query.isPackagePaidToShop));
    }
    if (query.shopAdvance === 'ADVANCED') {
      conditions.push(sql`${orders.shopAdvancedAt} is not null`);
    }
    if (query.shopAdvance === 'NOT_ADVANCED') {
      /**
       * A work list, not a null scan: an advance is only due where the customer
       * has not prepaid the package, and a cancelled order is never owed one.
       */
      conditions.push(and(
        sql`${orders.shopAdvancedAt} is null`,
        eq(orders.isPackagePaidToShop, false),
        ne(orders.status, 'CANCELLED'),
      ) as SQL);
    }
    const dateColumn = query.dateBasis === 'DELIVERED' ? orders.deliveredAt : orders.createdAt;
    if (query.dateFrom) conditions.push(sql`(${dateColumn} at time zone ${this.timeZone})::date >= ${query.dateFrom.slice(0, 10)}::date`);
    if (query.dateTo) conditions.push(sql`(${dateColumn} at time zone ${this.timeZone})::date <= ${query.dateTo.slice(0, 10)}::date`);
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [rows, countResult] = await Promise.all([
      this.database.db.select().from(orders).where(where).orderBy(desc(orders.createdAt)).limit(perPage).offset((page - 1) * perPage),
      this.database.db.select({ count: sql<number>`count(*)` }).from(orders).where(where),
    ]);
    const total = Number(countResult[0]?.count ?? 0);
    return { data: rows.map((row) => toOrderResponse(row, this.timeZone)), meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) } };
  }

  async getById(id: string): Promise<OrderDetailResponseDto> {
    const row = await this.orderOrThrow(id);
    return {
      ...toOrderResponse(row, this.timeZone),
      ...(await this.namesForOrder(row)),
      history: await this.historyForOrder(id),
    };
  }

  /**
   * The names a reader needs but cannot always fetch for themselves: an officer
   * holds `orders.read` while `shops.read`, `customers.read` and `riders.read`
   * are elsewhere. Null means the referenced row could not be resolved, never a
   * fabricated name.
   */
  private async namesForOrder(row: OrderRow): Promise<{
    shopName: string | null;
    customerName: string | null;
    townshipName: string | null;
    assigneeName: string | null;
  }> {
    const [shopRow, customerRow, townshipRow, riderRow, partnerRow] =
      await Promise.all([
        this.database.db
          .select({ name: shops.name })
          .from(shops)
          .where(eq(shops.id, row.shopId)),
        this.database.db
          .select({ name: customers.name })
          .from(customers)
          .where(eq(customers.id, row.customerId)),
        row.townshipId
          ? this.database.db
              .select({ name: townships.name })
              .from(townships)
              .where(eq(townships.id, row.townshipId))
          : Promise.resolve([]),
        row.riderId
          ? this.database.db
              .select({ name: users.name })
              .from(riders)
              .innerJoin(users, eq(users.id, riders.userId))
              .where(eq(riders.id, row.riderId))
          : Promise.resolve([]),
        row.partnerId
          ? this.database.db
              .select({ name: deliveryPartners.name })
              .from(deliveryPartners)
              .where(eq(deliveryPartners.id, row.partnerId))
          : Promise.resolve([]),
      ]);
    return {
      shopName: shopRow[0]?.name ?? null,
      customerName: customerRow[0]?.name ?? null,
      townshipName: townshipRow[0]?.name ?? null,
      assigneeName:
        row.assigneeType === 'RIDER'
          ? (riderRow[0]?.name ?? null)
          : row.assigneeType === 'PARTNER'
            ? (partnerRow[0]?.name ?? null)
            : null,
    };
  }

  async getHistory(id: string): Promise<OrderHistoryResponseDto[]> {
    await this.orderOrThrow(id);
    return this.historyForOrder(id);
  }

  async getAudit(id: string): Promise<OrderFieldAuditResponseDto[]> {
    await this.orderOrThrow(id);
    const rows = await this.database.db.select({
      id: orderFieldAudit.id,
      orderId: orderFieldAudit.orderId,
      field: orderFieldAudit.field,
      oldValue: sql<string | null>`${orderFieldAudit.oldValue}::text`,
      newValue: sql<string | null>`${orderFieldAudit.newValue}::text`,
      actorId: orderFieldAudit.actorId,
      reason: orderFieldAudit.reason,
      createdAt: orderFieldAudit.createdAt,
    }).from(orderFieldAudit)
      .where(eq(orderFieldAudit.orderId, id)).orderBy(asc(orderFieldAudit.createdAt));
    const entries = rows.map((row) => ({
      ...row,
      oldValue: row.oldValue === null ? null : JSON.parse(row.oldValue) as unknown,
      newValue: row.newValue === null ? null : JSON.parse(row.newValue) as unknown,
      createdAt: row.createdAt.toISOString(),
    }));
    return this.withResolvedIdentifiers(entries);
  }

  private async withResolvedIdentifiers(
    rows: OrderFieldAuditResponseDto[],
  ): Promise<OrderFieldAuditResponseDto[]> {
    const idsByField = new Map<AuditIdentifierField, Set<string>>();
    for (const row of rows) {
      if (!isAuditIdentifierField(row.field)) continue;
      for (const value of [row.oldValue, row.newValue]) {
        if (typeof value !== 'string') continue;
        const ids = idsByField.get(row.field) ?? new Set<string>();
        ids.add(value);
        idsByField.set(row.field, ids);
      }
    }
    if (idsByField.size === 0) return rows;

    const names = new Map<string, string>();
    await Promise.all(
      [...idsByField].map(async ([field, ids]) => {
        const resolved = await this.lookupAuditNames(field, [...ids]);
        for (const { id, name } of resolved) names.set(`${field}:${id}`, name);
      }),
    );

    /** A dangling id (a rider deleted after being unassigned) has no name left. */
    const resolve = (field: AuditIdentifierField, value: unknown): unknown =>
      typeof value === 'string'
        ? (names.get(`${field}:${value}`) ?? 'Unknown')
        : value;

    return rows.map((row) =>
      isAuditIdentifierField(row.field)
        ? {
            ...row,
            oldValue: resolve(row.field, row.oldValue),
            newValue: resolve(row.field, row.newValue),
          }
        : row,
    );
  }

  private async lookupAuditNames(
    field: AuditIdentifierField,
    ids: string[],
  ): Promise<Array<{ id: string; name: string }>> {
    switch (field) {
      case 'shopId':
        return this.database.db
          .select({ id: shops.id, name: shops.name })
          .from(shops)
          .where(inArray(shops.id, ids));
      case 'customerId':
        return this.database.db
          .select({ id: customers.id, name: customers.name })
          .from(customers)
          .where(inArray(customers.id, ids));
      case 'townshipId':
        return this.database.db
          .select({ id: townships.id, name: townships.name })
          .from(townships)
          .where(inArray(townships.id, ids));
      case 'partnerId':
        return this.database.db
          .select({ id: deliveryPartners.id, name: deliveryPartners.name })
          .from(deliveryPartners)
          .where(inArray(deliveryPartners.id, ids));
      case 'riderId':
        return this.database.db
          .select({ id: riders.id, name: users.name })
          .from(riders)
          .innerJoin(users, eq(users.id, riders.userId))
          .where(inArray(riders.id, ids));
    }
  }

  async create(input: CreateOrderDto, changedBy: string): Promise<OrderResponseDto> {
    await this.assertShopExists(input.shopId);
    await this.assertCustomerExists(input.customerId);
    const township = input.townshipId ? await this.townshipOrThrow(input.townshipId) : null;
    const assignee = await this.resolveCreateAssignee(input);
    const initialStatus: OrderStatus = assignee.type === null ? 'PENDING' : 'ASSIGNED';
    const estimatedDeliveryDate = input.estimatedDeliveryDate !== undefined
      ? dateToString(input.estimatedDeliveryDate)
      : township
        ? this.addDays(getDateInTimeZone(new Date(), this.timeZone), township.leadTimeDays)
        : null;

    for (let attempt = 1; attempt <= MAX_TRACKING_CODE_ATTEMPTS; attempt++) {
      try {
        const order = await this.database.db.transaction(async (transaction) => {
          const [inserted] = await transaction.insert(orders).values({
            trackingCode: generateTrackingCode(),
            shopId: input.shopId,
            customerId: input.customerId,
            townshipId: input.townshipId ?? null,
            assigneeType: assignee.type,
            riderId: assignee.riderId,
            partnerId: assignee.partnerId,
            partnerTrackingNo: assignee.type === 'PARTNER' ? input.partnerTrackingNo ?? null : null,
            packageInfo: input.packageInfo ?? null,
            packagePrice: input.packagePrice ?? '0',
            deliveryFee: input.deliveryFee ?? township?.defaultDeliveryFee ?? '0',
            isPackagePaidToShop: input.isPackagePaidToShop ?? false,
            isFeePaidToShop: input.isFeePaidToShop ?? false,
            /**
             * The effective assignee type owns both cost fields. Commission is a
             * rider earning, so a partner order never carries one — `partnerFee`
             * covers it instead. The mirror holds too: a partner fee or tracking
             * number is a partner's cost and reference, so an order without a
             * partner stores neither. The reports count `partnerFee` as partner
             * cost, and the edit form cannot clear the field for a non-partner,
             * so this is the only place that can.
             */
            partnerFee: assignee.type === 'PARTNER' ? input.partnerFee ?? '0.00' : '0.00',
            commissionFee: assignee.type === 'PARTNER'
              ? '0'
              : input.commissionFee ?? township?.defaultCommissionFee ?? '0',
            estimatedDeliveryDate,
            deliveryAddress: input.deliveryAddress ?? null,
            status: initialStatus,
            notes: input.notes ?? null,
          }).returning();
          await this.orderState.recordInitialStateInTransaction(transaction, {
            orderId: inserted.id,
            toStatus: initialStatus,
            changedBy,
            newAssignee: selectionToSnapshot(assignee),
          });
          return inserted;
        });
        return toOrderResponse(order, this.timeZone);
      } catch (error) {
        if (isUniqueViolation(error) && attempt < MAX_TRACKING_CODE_ATTEMPTS) continue;
        if (isUniqueViolation(error)) throw new ConflictException('Could not allocate a unique tracking code; retry the request');
        throw error;
      }
    }
    throw new ConflictException('Could not allocate a unique tracking code; retry the request');
  }

  async update(id: string, input: UpdateOrderDto, actorId: string): Promise<OrderResponseDto> {
    const existing = await this.orderOrThrow(id);
    // `DELIVERED` and `CANCELLED` have no transition out of them: the order has
    // ended, so it is immutable rather than merely hard to change. The shop
    // advance is not an edit and stays available through its own endpoints.
    if (this.orderState.isTerminalStatus(existing.status)) {
      throw new ConflictException(`Order '${id}' is '${existing.status}' and can no longer be edited`);
    }
    const changes: OrderChanges = {};
    const candidateFields: Partial<Record<keyof OrderChanges, unknown>> = {
      ...(input.shopId !== undefined && { shopId: input.shopId }),
      ...(input.customerId !== undefined && { customerId: input.customerId }),
      ...(input.townshipId !== undefined && { townshipId: input.townshipId }),
      ...(input.partnerTrackingNo !== undefined && { partnerTrackingNo: input.partnerTrackingNo }),
      ...(input.packageInfo !== undefined && { packageInfo: input.packageInfo }),
      ...(input.packagePrice !== undefined && { packagePrice: input.packagePrice }),
      ...(input.deliveryFee !== undefined && { deliveryFee: input.deliveryFee }),
      ...(input.isPackagePaidToShop !== undefined && { isPackagePaidToShop: input.isPackagePaidToShop }),
      ...(input.isFeePaidToShop !== undefined && { isFeePaidToShop: input.isFeePaidToShop }),
      ...(input.partnerFee !== undefined && { partnerFee: input.partnerFee }),
      ...(input.commissionFee !== undefined && { commissionFee: input.commissionFee }),
      ...(input.estimatedDeliveryDate !== undefined && { estimatedDeliveryDate: dateToString(input.estimatedDeliveryDate) }),
      ...(input.deliveryAddress !== undefined && { deliveryAddress: input.deliveryAddress }),
      ...(input.notes !== undefined && { notes: input.notes }),
    };
    if (input.townshipId && input.townshipId !== existing.townshipId) {
      const township = await this.townshipOrThrow(input.townshipId);
      if (input.estimatedDeliveryDate === undefined) {
        candidateFields.estimatedDeliveryDate = this.addDays(getDateInTimeZone(new Date(), this.timeZone), township.leadTimeDays);
      }
      if (input.applyTownshipFee && input.deliveryFee === undefined) candidateFields.deliveryFee = township.defaultDeliveryFee;
      if (input.applyTownshipFee && input.commissionFee === undefined) candidateFields.commissionFee = township.defaultCommissionFee;
    }
    if (input.riderId !== undefined || input.partnerId !== undefined) {
      const assignment = this.assigneeFromInput(input.riderId, input.partnerId);
      candidateFields.assigneeType = assignment.type;
      candidateFields.riderId = assignment.riderId;
      candidateFields.partnerId = assignment.partnerId;
    }

    if (candidateFields.shopId !== undefined) await this.assertShopExists(candidateFields.shopId as string);
    if (candidateFields.customerId !== undefined) await this.assertCustomerExists(candidateFields.customerId as string);
    const assignmentChanged = ['assigneeType', 'riderId', 'partnerId'].some((field) => candidateFields[field as keyof typeof candidateFields] !== undefined);
    if (assignmentChanged) {
      await this.assertAssigneeExists(
        candidateFields.assigneeType !== undefined
          ? candidateFields.assigneeType as AssigneeType | null
          : existing.assigneeType,
        candidateFields.riderId !== undefined
          ? candidateFields.riderId as string | null
          : existing.riderId,
        candidateFields.partnerId !== undefined
          ? candidateFields.partnerId as string | null
          : existing.partnerId,
      );
    }
    const effectiveAssigneeType = (candidateFields.assigneeType !== undefined
      ? candidateFields.assigneeType
      : existing.assigneeType) as AssigneeType | null;
    /**
     * Partner orders never carry a rider commission (see `create`). The forced
     * value is the column's own canonical form, `'0.00'`: `'0'` compares
     * unequal to the stored `'0.00'` and would land in `changes` as a money
     * change on every partner-order edit, writing an `order_field_audit` row
     * for a commission that never moved.
     */
    if (effectiveAssigneeType === 'PARTNER') candidateFields.commissionFee = '0.00';
    /**
     * The mirror of the rule above (see `create`). Forcing it here is what
     * clears the partner's fee when an order is reassigned to a rider or to
     * nobody: `POST /orders/:id/assign` does not touch money fields, and an
     * edit that does not mention `partnerFee` would carry the old value
     * forward. `'0.00'` is the column's own form, so an order that is already
     * correct produces no change and no field-audit row.
     */
    if (effectiveAssigneeType !== 'PARTNER') {
      candidateFields.partnerFee = '0.00';
      candidateFields.partnerTrackingNo = null;
    }

    const changedCandidate = Object.entries(candidateFields).filter(([field, value]) =>
      !sameValue(existing[field as keyof OrderRow], value),
    );
    if (changedCandidate.length === 0) return toOrderResponse(existing, this.timeZone);
    for (const [field, value] of changedCandidate) {
      (changes as Record<string, unknown>)[field] = value;
    }

    if (changes.shopId) await this.assertShopExists(changes.shopId);
    if (changes.customerId) await this.assertCustomerExists(changes.customerId);
    const updated = await this.database.db.transaction(async (transaction) => {
      const [current] = await transaction.select().from(orders).where(eq(orders.id, id)).for('update');
      if (!current) throw new NotFoundException(`Order '${id}' not found`);
      if (current.updatedAt.getTime() !== existing.updatedAt.getTime()) {
        throw new ConflictException('Order changed while this edit was being prepared; reload and retry');
      }
      const previousAssignee = toAssigneeSnapshot(current);
      const newAssignment: AssigneeSelection = assignmentChanged
        ? {
            type: candidateFields.assigneeType !== undefined
              ? candidateFields.assigneeType as AssigneeType | null
              : current.assigneeType,
            riderId: candidateFields.riderId !== undefined
              ? candidateFields.riderId as string | null
              : current.riderId,
            partnerId: candidateFields.partnerId !== undefined
              ? candidateFields.partnerId as string | null
              : current.partnerId,
          }
        : {
            type: previousAssignee?.type ?? null,
            riderId: previousAssignee?.riderId ?? null,
            partnerId: previousAssignee?.partnerId ?? null,
          };
      const newAssigneeSnapshot = selectionToSnapshot(newAssignment);
      const changedAssignee = assignmentChanged && !sameValue(previousAssignee, newAssigneeSnapshot);
      let status = current.status;
      if (changedAssignee) {
        const nextStatus: OrderStatus = newAssigneeSnapshot === null ? 'PENDING' : 'ASSIGNED';
        if (current.status !== nextStatus || current.status === 'ASSIGNED') {
          await this.orderState.applyTransitionInTransaction(transaction, {
            orderId: id,
            fromStatus: current.status,
            toStatus: nextStatus,
            changedBy: actorId,
            reason: input.reason ?? undefined,
            previousAssignee,
            newAssignee: newAssigneeSnapshot,
            updates: {
              assigneeType: newAssignment.type,
              riderId: newAssignment.riderId,
              partnerId: newAssignment.partnerId,
            },
          });
          status = nextStatus;
        }
      }

      const nonAssignmentChanges = { ...changes };
      delete nonAssignmentChanges.assigneeType;
      delete nonAssignmentChanges.riderId;
      delete nonAssignmentChanges.partnerId;
      if (Object.keys(nonAssignmentChanges).length > 0) {
        await transaction.update(orders).set({ ...nonAssignmentChanges, updatedAt: new Date() }).where(eq(orders.id, id));
      }
      await transaction.insert(orderFieldAudit).values(changedCandidate.map(([field, newValue]) => ({
        orderId: id,
        field,
        oldValue: toAuditJson(current[field as keyof OrderRow], (MONEY_FIELDS as readonly string[]).includes(field)),
        newValue: toAuditJson(newValue, (MONEY_FIELDS as readonly string[]).includes(field)),
        actorId,
        reason: input.reason ?? null,
      })));
      const [row] = await transaction.select().from(orders).where(eq(orders.id, id));
      if (!row) throw new NotFoundException(`Order '${id}' not found`);
      return { ...row, status };
    });
    return toOrderResponse(updated, this.timeZone);
  }

  async assign(id: string, input: AssignOrderDto, actorId: string): Promise<OrderResponseDto> {
    if (input.riderId !== undefined && input.partnerId !== undefined && input.riderId !== null && input.partnerId !== null) {
      throw new BadRequestException('An order cannot be assigned to both a rider and a delivery partner');
    }
    const assignment = this.assigneeFromInput(input.riderId, input.partnerId);
    await this.assertAssigneeExists(assignment.type, assignment.riderId, assignment.partnerId);
    return this.transitionAssignee(id, assignment, actorId);
  }

  async cancel(id: string, input: OrderReasonDto, actorId: string): Promise<OrderResponseDto> {
    return this.changeState(id, actorId, 'CANCELLED', {
      reason: input.reason,
      note: 'Order cancelled',
      updates: { cancelReason: input.reason },
    });
  }

  async postpone(id: string, input: OrderReasonDto, actorId: string): Promise<OrderResponseDto> {
    await this.database.db.transaction(async (transaction) => {
      const [current] = await transaction.select().from(orders).where(eq(orders.id, id)).for('update');
      if (!current) throw new NotFoundException(`Order '${id}' not found`);
      await this.orderState.applyTransitionInTransaction(transaction, {
        orderId: id,
        fromStatus: current.status,
        toStatus: 'PENDING',
        changedBy: actorId,
        reason: input.reason,
        note: 'Delivery postponed',
        previousAssignee: toAssigneeSnapshot(current),
        newAssignee: null,
        updates: { assigneeType: null, riderId: null, partnerId: null },
      });
    });
    return toOrderResponse(await this.orderOrThrow(id), this.timeZone);
  }

  async approve(id: string, actorId: string): Promise<OrderResponseDto> {
    return this.changeState(id, actorId, 'DELIVERED', { note: 'Delivery approved' });
  }

  async sendBack(id: string, input: SendBackOrderDto, actorId: string): Promise<OrderResponseDto> {
    return this.changeState(id, actorId, 'ASSIGNED', {
      reason: input.reason,
      internalNote: input.internalNote,
      note: 'Delivery submission sent back for correction',
    });
  }

  async markPartnerDelivered(id: string, actorId: string): Promise<OrderResponseDto> {
    await this.database.db.transaction(async (transaction) => {
      await this.orderState.markPartnerDeliveredInTransaction(transaction, id, actorId, new Date());
    });
    return toOrderResponse(await this.orderOrThrow(id), this.timeZone);
  }

  /**
   * Record that the company paid this shop the package price for this order.
   *
   * The amount is a snapshot of `packagePrice` taken here and is never an input:
   * the design's anti-goals forbid writing the column as anything else, and a
   * later `packagePrice` edit must not restate money that already moved.
   */
  async recordShopAdvance(id: string, input: ShopAdvanceDto, actorId: string, roleId: string): Promise<OrderResponseDto> {
    const updated = await this.database.db.transaction(async (transaction) => {
      const [current] = await transaction.select().from(orders).where(eq(orders.id, id)).for('update');
      if (!current) throw new NotFoundException(`Order '${id}' not found`);
      if (current.isPackagePaidToShop) {
        throw new ConflictException('No advance is due: the customer already paid the shop for this package');
      }
      if (current.shopAdvancedAt !== null) {
        throw new ConflictException('An advance is already recorded for this order; clear it before recording another');
      }
      await this.assertShopSettlementAfterApprovalAllowed(current, input.reason, roleId);
      const advancedAt = new Date();
      const [row] = await transaction.update(orders).set({
        shopAdvanceAmount: current.packagePrice,
        shopAdvancedAt: advancedAt,
        updatedAt: advancedAt,
      }).where(eq(orders.id, id)).returning();
      if (!row) throw new NotFoundException(`Order '${id}' not found`);
      await transaction.insert(orderFieldAudit).values([
        {
          orderId: id,
          field: 'shopAdvanceAmount',
          oldValue: toAuditJson(current.shopAdvanceAmount, true),
          newValue: toAuditJson(row.shopAdvanceAmount, true),
          actorId,
          reason: input.reason ?? null,
        },
        {
          orderId: id,
          field: 'shopAdvancedAt',
          oldValue: toAuditJson(current.shopAdvancedAt, false),
          newValue: toAuditJson(row.shopAdvancedAt, false),
          actorId,
          reason: input.reason ?? null,
        },
      ]);
      return row;
    });
    return toOrderResponse(updated, this.timeZone);
  }

  /**
   * Clear a recorded advance, correcting a mistake.
   *
   * Refused on a cancelled order: once the delivery is off, that advance is
   * money the shop owes back, and Phase 2's reclaim reports it — so it must not
   * be erasable from here. The guard costs nothing today and keeps that
   * recovery from being deleted by a settlement caller.
   */
  async clearShopAdvance(id: string, input: ShopAdvanceDto, actorId: string, roleId: string): Promise<OrderResponseDto> {
    const updated = await this.database.db.transaction(async (transaction) => {
      const [current] = await transaction.select().from(orders).where(eq(orders.id, id)).for('update');
      if (!current) throw new NotFoundException(`Order '${id}' not found`);
      if (current.shopAdvancedAt === null) {
        throw new ConflictException('No advance is recorded for this order');
      }
      if (current.status === 'CANCELLED') {
        throw new ConflictException('The advance on a cancelled order is money the shop owes back and cannot be cleared');
      }
      await this.assertShopSettlementAfterApprovalAllowed(current, input.reason, roleId);
      const clearedAt = new Date();
      const [row] = await transaction.update(orders).set({
        shopAdvanceAmount: '0',
        shopAdvancedAt: null,
        updatedAt: clearedAt,
      }).where(eq(orders.id, id)).returning();
      if (!row) throw new NotFoundException(`Order '${id}' not found`);
      await transaction.insert(orderFieldAudit).values([
        {
          orderId: id,
          field: 'shopAdvanceAmount',
          oldValue: toAuditJson(current.shopAdvanceAmount, true),
          newValue: toAuditJson('0', true),
          actorId,
          reason: input.reason ?? null,
        },
        {
          orderId: id,
          field: 'shopAdvancedAt',
          oldValue: toAuditJson(current.shopAdvancedAt, false),
          newValue: toAuditJson(null, false),
          actorId,
          reason: input.reason ?? null,
        },
      ]);
      return row;
    });
    return toOrderResponse(updated, this.timeZone);
  }

  /**
   * An advance is a settled cost. Changing one on a `DELIVERED` order follows
   * the same rule as every other post-approval money edit: the caller needs
   * `orders.update_after_approval` and a reason. Holding
   * `orders.shop_settlement` is not a bypass.
   */
  private async assertShopSettlementAfterApprovalAllowed(order: OrderRow, reason: string | undefined, roleId: string): Promise<void> {
    if (order.status !== 'DELIVERED') return;
    const effectivePermissions = await this.permissions.getEffectivePermissions(roleId);
    if (!effectivePermissions.includes('orders.update_after_approval')) {
      throw new ForbiddenException('Changing the shop advance after approval requires orders.update_after_approval');
    }
    if (!reason?.trim()) throw new BadRequestException('A reason is required when changing the shop advance after approval');
  }

  async submitRiderDelivered(id: string, userId: string): Promise<RiderDeliveredResponseDto> {
    const rider = await this.database.db.query.riders.findFirst({ where: eq(riders.userId, userId), columns: { id: true } });
    if (!rider) throw new ForbiddenException('Authenticated user is not a rider');
    const ownedOrder = await this.database.db.query.orders.findFirst({
      where: and(eq(orders.id, id), eq(orders.riderId, rider.id), eq(orders.assigneeType, 'RIDER')),
      columns: { id: true },
    });
    if (!ownedOrder) throw new NotFoundException(`Assigned order '${id}' not found`);
    await this.database.db.transaction(async (transaction) => {
      await this.orderState.submitRiderDeliveredInTransaction(transaction, id, rider.id, userId, new Date());
    });
    const order = await this.orderOrThrow(id);
    if (!order.deliveredAt) throw new ConflictException('Delivered timestamp was not recorded');
    return { id: order.id, status: order.status, deliveredAt: order.deliveredAt.toISOString() };
  }

  async listRiderAssignedOrders(userId: string): Promise<RiderOrderResponseDto[]> {
    const rider = await this.database.db.query.riders.findFirst({
      where: eq(riders.userId, userId),
      columns: { id: true },
    });
    if (!rider) throw new ForbiddenException('Authenticated user is not a rider');

    const rows = await this.database.db
      .select({
        id: orders.id,
        trackingCode: orders.trackingCode,
        customerName: customers.name,
        customerPhone: customers.phone,
        customerAddress: sql<string | null>`coalesce(${orders.deliveryAddress}, ${customers.address})`,
        townshipName: townships.name,
        notes: orders.notes,
        packagePrice: orders.packagePrice,
        deliveryFee: orders.deliveryFee,
        isPackagePaidToShop: orders.isPackagePaidToShop,
        isFeePaidToShop: orders.isFeePaidToShop,
      })
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .leftJoin(townships, eq(orders.townshipId, townships.id))
      .where(
        and(
          eq(orders.riderId, rider.id),
          eq(orders.assigneeType, 'RIDER'),
          eq(orders.status, 'ASSIGNED'),
        ),
      )
      .orderBy(desc(orders.createdAt));

    return rows.map((row) => ({
      id: row.id,
      trackingCode: row.trackingCode,
      customerName: row.customerName,
      customerPhone: row.customerPhone,
      customerAddress: row.customerAddress,
      townshipName: row.townshipName,
      notes: row.notes,
      packagePrice: row.packagePrice,
      deliveryFee: row.deliveryFee,
      codToCollect: calculateCodToCollect(
        row.packagePrice,
        row.deliveryFee,
        row.isPackagePaidToShop,
        row.isFeePaidToShop,
      ),
      status: 'ASSIGNED',
    }));
  }

  private async transitionAssignee(id: string, assignment: AssigneeSelection, actorId: string): Promise<OrderResponseDto> {
    await this.database.db.transaction(async (transaction) => {
      const [current] = await transaction.select().from(orders).where(eq(orders.id, id)).for('update');
      if (!current) throw new NotFoundException(`Order '${id}' not found`);
      const previousAssignee = toAssigneeSnapshot(current);
      const selectedAssignee = selectionToSnapshot(assignment);
      const unchanged = sameValue(previousAssignee, selectedAssignee);
      const nextStatus: OrderStatus = selectedAssignee === null ? 'PENDING' : 'ASSIGNED';
      if (unchanged && current.status === nextStatus) return;
      await this.orderState.applyTransitionInTransaction(transaction, {
        orderId: id,
        fromStatus: current.status,
        toStatus: nextStatus,
        changedBy: actorId,
        note: assignment === null ? 'Order unassigned' : 'Order assigned or reassigned',
        previousAssignee,
        newAssignee: selectedAssignee,
        updates: {
          assigneeType: assignment?.type ?? null,
          riderId: assignment?.riderId ?? null,
          partnerId: assignment?.partnerId ?? null,
        },
      });
    });
    return toOrderResponse(await this.orderOrThrow(id), this.timeZone);
  }

  private async changeState(
    id: string,
    actorId: string,
    toStatus: OrderStatus,
    details: {
      note: string;
      reason?: string;
      internalNote?: string;
      updates?: Partial<Pick<typeof orders.$inferInsert, 'cancelReason'>>;
    },
  ): Promise<OrderResponseDto> {
    await this.database.db.transaction(async (transaction) => {
        const [current] = await transaction.select().from(orders).where(eq(orders.id, id)).for('update');
        if (!current) throw new NotFoundException(`Order '${id}' not found`);
        const transitionUpdates = { ...details.updates };
        await this.orderState.applyTransitionInTransaction(transaction, {
        orderId: id,
        fromStatus: current.status,
        toStatus,
        changedBy: actorId,
        note: details.note,
        reason: details.reason,
        internalNote: details.internalNote,
          updates: transitionUpdates,
      });
    });
    return toOrderResponse(await this.orderOrThrow(id), this.timeZone);
  }

  private async resolveCreateAssignee(input: CreateOrderDto): Promise<AssigneeSelection> {
    if (input.riderId !== undefined || input.partnerId !== undefined) {
      if (input.riderId !== undefined && input.partnerId !== undefined) {
        throw new BadRequestException('Provide riderId or partnerId, not both');
      }
      const assignment = this.assigneeFromInput(input.riderId, input.partnerId);
      await this.assertAssigneeExists(assignment.type, assignment.riderId, assignment.partnerId);
      return assignment;
    }
    /**
     * A township carries money and lead-time defaults only — it never names an
     * assignee, so an order with no explicit rider or partner starts unassigned.
     */
    return { type: null, riderId: null, partnerId: null };
  }

  private assigneeFromInput(riderId: string | null | undefined, partnerId: string | null | undefined): AssigneeSelection {
    if (riderId && partnerId) throw new BadRequestException('An order cannot be assigned to both a rider and a delivery partner');
    if (riderId) return { type: 'RIDER', riderId, partnerId: null };
    if (partnerId) return { type: 'PARTNER', riderId: null, partnerId };
    return { type: null, riderId: null, partnerId: null };
  }

  private async assertAssigneeExists(type: AssigneeType | null, riderId: string | null, partnerId: string | null): Promise<void> {
    if (type === 'RIDER' && riderId) {
      const rider = await this.database.db.query.riders.findFirst({ where: eq(riders.id, riderId), columns: { id: true } });
      if (!rider) throw new BadRequestException(`Rider '${riderId}' not found`);
    } else if (type === 'PARTNER' && partnerId) {
      const partner = await this.database.db.query.deliveryPartners.findFirst({ where: and(eq(deliveryPartners.id, partnerId), eq(deliveryPartners.isActive, true)), columns: { id: true } });
      if (!partner) throw new BadRequestException(`Active delivery partner '${partnerId}' not found`);
    } else if (type !== null || riderId !== null || partnerId !== null) {
      throw new BadRequestException('Assignee type and id must match');
    }
  }

  private addDays(localDate: string, days: number): Date {
    const [year, month, day] = localDate.split('-').map(Number);
    const result = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
    result.setUTCDate(result.getUTCDate() + days);
    return result;
  }

  private async historyForOrder(orderId: string): Promise<OrderHistoryResponseDto[]> {
    const rows = await this.database.db
      .select({
        id: orderStatusHistory.id,
        orderId: orderStatusHistory.orderId,
        fromStatus: orderStatusHistory.fromStatus,
        toStatus: orderStatusHistory.toStatus,
        changedBy: orderStatusHistory.changedBy,
        changedByName: users.name,
        note: orderStatusHistory.note,
        reason: orderStatusHistory.reason,
        internalNote: orderStatusHistory.internalNote,
        previousAssignee: orderStatusHistory.previousAssignee,
        newAssignee: orderStatusHistory.newAssignee,
        createdAt: orderStatusHistory.createdAt,
      })
      .from(orderStatusHistory)
      .leftJoin(users, eq(users.id, orderStatusHistory.changedBy))
      .where(eq(orderStatusHistory.orderId, orderId))
      .orderBy(asc(orderStatusHistory.createdAt));
    return rows.map(toOrderHistoryResponse);
  }

  private async orderOrThrow(id: string): Promise<OrderRow> {
    const [row] = await this.database.db.select().from(orders).where(eq(orders.id, id));
    if (!row) throw new NotFoundException(`Order '${id}' not found`);
    return row;
  }

  private async townshipOrThrow(id: string): Promise<typeof townships.$inferSelect> {
    const township = await this.database.db.query.townships.findFirst({ where: eq(townships.id, id) });
    if (!township) throw new BadRequestException(`Township '${id}' not found`);
    return township;
  }

  private async assertShopExists(shopId: string): Promise<void> {
    const shop = await this.database.db.query.shops.findFirst({ where: eq(shops.id, shopId), columns: { id: true } });
    if (!shop) throw new BadRequestException(`Shop '${shopId}' not found`);
  }

  private async assertCustomerExists(customerId: string): Promise<void> {
    const customer = await this.database.db.query.customers.findFirst({ where: eq(customers.id, customerId), columns: { id: true } });
    if (!customer) throw new BadRequestException(`Customer '${customerId}' not found`);
  }
}
