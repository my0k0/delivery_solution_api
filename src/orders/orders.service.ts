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
const MONEY_FIELDS = [
  'packagePrice',
  'deliveryFee',
  'isPackagePaidToShop',
  'isFeePaidToShop',
  'partnerFee',
  'commissionFee',
] as const;

type OrderRow = typeof orders.$inferSelect;
type OrderHistoryRow = typeof orderStatusHistory.$inferSelect;
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

export function toOrderHistoryResponse(row: OrderHistoryRow): OrderHistoryResponseDto {
  return {
    id: row.id,
    orderId: row.orderId,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    changedBy: row.changedBy,
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
    return { ...toOrderResponse(row, this.timeZone), history: await this.historyForOrder(id) };
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
    return rows.map((row) => ({
      ...row,
      oldValue: row.oldValue === null ? null : JSON.parse(row.oldValue) as unknown,
      newValue: row.newValue === null ? null : JSON.parse(row.newValue) as unknown,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async create(input: CreateOrderDto, changedBy: string): Promise<OrderResponseDto> {
    await this.assertShopExists(input.shopId);
    await this.assertCustomerExists(input.customerId);
    const township = input.townshipId ? await this.townshipOrThrow(input.townshipId) : null;
    const assignee = await this.resolveCreateAssignee(input, township);
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
            partnerTrackingNo: input.partnerTrackingNo ?? null,
            packageInfo: input.packageInfo ?? null,
            packagePrice: input.packagePrice ?? '0',
            deliveryFee: input.deliveryFee ?? township?.defaultDeliveryFee ?? '0',
            isPackagePaidToShop: input.isPackagePaidToShop ?? false,
            isFeePaidToShop: input.isFeePaidToShop ?? false,
            partnerFee: input.partnerFee ?? '0',
            /**
             * Commission is a rider earning. Partner orders are covered by
             * `partnerFee` instead, so they never carry one — the invariant the
             * deleted `orders_partner_way_consistency_check` used to hold.
             */
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

  async update(id: string, input: UpdateOrderDto, actorId: string, roleId: string): Promise<OrderResponseDto> {
    const existing = await this.orderOrThrow(id);
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
      if (input.applyTownshipAssignee) {
        candidateFields.assigneeType = township.defaultAssigneeType;
        candidateFields.riderId = township.defaultRiderId;
        candidateFields.partnerId = township.defaultPartnerId;
      }
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
    /** Partner orders never carry a rider commission (see `create`). */
    const effectiveAssigneeType = (candidateFields.assigneeType !== undefined
      ? candidateFields.assigneeType
      : existing.assigneeType) as AssigneeType | null;
    if (effectiveAssigneeType === 'PARTNER') candidateFields.commissionFee = '0';

    const changedCandidate = Object.entries(candidateFields).filter(([field, value]) =>
      !sameValue(existing[field as keyof OrderRow], value),
    );
    if (changedCandidate.length === 0) return toOrderResponse(existing, this.timeZone);
    for (const [field, value] of changedCandidate) {
      (changes as Record<string, unknown>)[field] = value;
    }

    const changedMoneyFields = changedCandidate.filter(([field]) =>
      (MONEY_FIELDS as readonly string[]).includes(field),
    );
    let effectivePermissions: string[] = [];
    if (changedMoneyFields.length > 0) {
      effectivePermissions = await this.permissions.getEffectivePermissions(roleId);
      if (existing.status === 'DELIVERED') {
        if (!effectivePermissions.includes('orders.update_after_approval')) {
          throw new ForbiddenException('Changing costs after approval requires orders.update_after_approval');
        }
        if (!input.reason?.trim()) throw new BadRequestException('A reason is required when changing costs after approval');
      }
    }

    if (changes.shopId) await this.assertShopExists(changes.shopId);
    if (changes.customerId) await this.assertCustomerExists(changes.customerId);
    const updated = await this.database.db.transaction(async (transaction) => {
      const [current] = await transaction.select().from(orders).where(eq(orders.id, id)).for('update');
      if (!current) throw new NotFoundException(`Order '${id}' not found`);
      if (current.updatedAt.getTime() !== existing.updatedAt.getTime()) {
        throw new ConflictException('Order changed while this edit was being prepared; reload and retry');
      }
      if (current.status === 'DELIVERED' && changedMoneyFields.length > 0) {
        if (!effectivePermissions.includes('orders.update_after_approval')) {
          throw new ForbiddenException('Changing costs after approval requires orders.update_after_approval');
        }
        if (!input.reason?.trim()) throw new BadRequestException('A reason is required when changing costs after approval');
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

  private async resolveCreateAssignee(
    input: CreateOrderDto,
    township: typeof townships.$inferSelect | null,
  ): Promise<AssigneeSelection> {
    if (input.riderId !== undefined || input.partnerId !== undefined) {
      if (input.riderId !== undefined && input.partnerId !== undefined) {
        throw new BadRequestException('Provide riderId or partnerId, not both');
      }
      const assignment = this.assigneeFromInput(input.riderId, input.partnerId);
      await this.assertAssigneeExists(assignment.type, assignment.riderId, assignment.partnerId);
      return assignment;
    }
    if (!township || township.defaultAssigneeType === null) return { type: null, riderId: null, partnerId: null };
    const assignment: AssigneeSnapshot = {
      type: township.defaultAssigneeType,
      riderId: township.defaultRiderId,
      partnerId: township.defaultPartnerId,
    };
    await this.assertAssigneeExists(assignment.type, assignment.riderId, assignment.partnerId);
    return assignment;
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
    const rows = await this.database.db.select().from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, orderId)).orderBy(asc(orderStatusHistory.createdAt));
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
