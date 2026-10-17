import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, count, eq, exists, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { DatabaseService } from '../common/database/database.service.js';
import type { AuthenticatedUser } from '../common/auth/auth.constants.js';
import { getDateInTimeZone } from '../common/utils/timezone-date.util.js';
import { escapeLikeWildcards } from '../common/utils/normalize.util.js';
import { customers } from '../customers/customer.schema.js';
import { orderStatusHistory } from '../orders/order-status-history.schema.js';
import { orders, type OrderStatus } from '../orders/order.schema.js';
import { townships } from '../townships/township.schema.js';
import { ShopStatementService } from '../reports/reports.service.js';
import { codToCollectSql, netOwedToShopSql } from '../reports/report-money.util.js';
import type { DateRangeQueryDto } from '../reports/dto/report-query.dto.js';
import {
  shopOrderNeedsAttention,
  toShopDisplayStatus,
  toShopVisibleHistory,
  type ShopDisplayStatus,
} from './shop-display-status.util.js';
import type { ShopOrdersExportQueryDto, ShopOrdersQueryDto, ShopStatementExportQueryDto, ShopStatementQueryDto, ShopDashboardQueryDto, ShopDateBasis } from './dto/shop-portal-query.dto.js';
import type { ShopOrderListItemDto, ShopOrderListResponseDto } from './dto/shop-order-list-response.dto.js';
import type { ShopOrderDetailResponseDto } from './dto/shop-order-detail-response.dto.js';
import type { ShopDashboardResponseDto, ShopOrdersPerDayDto } from './dto/shop-dashboard-response.dto.js';
import type { ShopStatementResponseDto } from './dto/shop-statement-response.dto.js';

const ZERO_MONEY = '0.00';
const MAX_EXPORT_ROWS = 50_000;

interface NormalizedFilters {
  dateFrom: string;
  dateTo: string;
  dateBasis: ShopDateBasis;
  timeFrom?: string;
  timeTo?: string;
  displayStatus?: ShopDisplayStatus;
  needsAttention?: boolean;
  search?: string;
}

interface ShopOrderDbRow {
  id: string;
  trackingCode: string;
  customerName: string;
  customerPhone: string | null;
  deliveryAddress: string | null;
  townshipName: string | null;
  packagePrice: string;
  deliveryFee: string;
  total: string;
  codToCollect: string;
  netOwedToShop: string;
  isPackagePaidToShop: boolean;
  isFeePaidToShop: boolean;
  status: OrderStatus;
  latestReason: string | null;
  createdAt: Date;
  deliveredAt: Date | null;
  estimatedDeliveryDate: Date | null;
}

interface ShopExportRow {
  order: ShopOrderListItemDto;
}

function dateColumn(dateBasis: ShopDateBasis): SQL {
  return dateBasis === 'DELIVERED' ? sql`${orders.deliveredAt}` : sql`${orders.createdAt}`;
}

function displayStatusCondition(displayStatus: ShopDisplayStatus): SQL {
  switch (displayStatus) {
    case 'RECEIVED':
      return eq(orders.status, 'PENDING');
    case 'OUT_FOR_DELIVERY':
      return inArray(orders.status, ['ASSIGNED', 'AWAITING_APPROVAL']);
    case 'DELIVERED':
      return eq(orders.status, 'DELIVERED');
    case 'CANCELLED':
      return eq(orders.status, 'CANCELLED');
  }
}

function latestPostponeOrSendBackReasonSql(): SQL<string | null> {
  return sql<string | null>`(
    select ${orderStatusHistory.reason}
    from ${orderStatusHistory}
    where ${orderStatusHistory.orderId} = ${orders.id}
      and ((${orderStatusHistory.fromStatus} = 'ASSIGNED' and ${orderStatusHistory.toStatus} = 'PENDING')
        or (${orderStatusHistory.fromStatus} = 'AWAITING_APPROVAL' and ${orderStatusHistory.toStatus} = 'ASSIGNED'))
    order by ${orderStatusHistory.createdAt} desc, ${orderStatusHistory.id} desc
    limit 1
  )`;
}

function needsAttentionSql(today: string): SQL<boolean> {
  return sql<boolean>`(
    ${orders.status} in ('PENDING', 'ASSIGNED', 'AWAITING_APPROVAL')
    and (
      (${orders.estimatedDeliveryDate} is not null and ${orders.estimatedDeliveryDate} < ${today}::date)
      or ${latestPostponeOrSendBackReasonSql()} is not null
    )
  )`;
}

@Injectable()
export class ShopPortalService {
  private readonly timeZone: string;

  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
    private readonly statementService: ShopStatementService,
  ) {
    this.timeZone = this.config.get<string>('APP_TIMEZONE') ?? 'Asia/Yangon';
  }

  async getOrders(user: AuthenticatedUser, query: ShopOrdersQueryDto): Promise<ShopOrderListResponseDto> {
    const shopId = this.shopIdOrThrow(user);
    const filters = this.normalizeFilters(query);
    const where = this.orderConditions(shopId, filters);
    const [rows, [totals]] = await Promise.all([
      this.selectOrderRows(where, filters, query.page, query.perPage),
      this.selectTotals(where),
    ]);
    const totalOrderCount = Number(totals?.orderCount ?? 0);
    const data = rows.map((row) => this.toListItem(row));
    return {
      data,
      meta: {
        page: query.page,
        perPage: query.perPage,
        total: totalOrderCount,
        totalPages: Math.ceil(totalOrderCount / query.perPage),
      },
      totals: {
        orderCount: totalOrderCount,
        packagePrice: totals?.packagePrice ?? ZERO_MONEY,
        deliveryFee: totals?.deliveryFee ?? ZERO_MONEY,
        total: totals?.total ?? ZERO_MONEY,
        codToCollect: totals?.codToCollect ?? ZERO_MONEY,
        netOwedToShop: totals?.netOwedToShop ?? ZERO_MONEY,
      },
    };
  }

  async getOrder(user: AuthenticatedUser, id: string): Promise<ShopOrderDetailResponseDto> {
    const shopId = this.shopIdOrThrow(user);
    const today = this.today();
    const where = and(eq(orders.id, id), eq(orders.shopId, shopId));
    const [row] = await this.database.db.select({
      id: orders.id,
      trackingCode: orders.trackingCode,
      customerName: customers.name,
      customerPhone: customers.phone,
      deliveryAddress: sql<string | null>`coalesce(${orders.deliveryAddress}, ${customers.address})`,
      townshipName: townships.name,
      packagePrice: orders.packagePrice,
      deliveryFee: orders.deliveryFee,
      total: sql<string>`(${orders.packagePrice} + ${orders.deliveryFee})::numeric(14, 2)::text`,
      codToCollect: sql<string>`case when ${orders.status} in ('PENDING', 'ASSIGNED', 'AWAITING_APPROVAL', 'DELIVERED') then ${codToCollectSql(orders)} else 0::numeric end::numeric(14, 2)::text`,
      netOwedToShop: sql<string>`case when ${orders.status} in ('PENDING', 'ASSIGNED', 'AWAITING_APPROVAL', 'DELIVERED') then ${netOwedToShopSql(orders)} else 0::numeric end::numeric(14, 2)::text`,
      isPackagePaidToShop: orders.isPackagePaidToShop,
      isFeePaidToShop: orders.isFeePaidToShop,
      status: orders.status,
      latestReason: latestPostponeOrSendBackReasonSql(),
      createdAt: orders.createdAt,
      deliveredAt: orders.deliveredAt,
      estimatedDeliveryDate: orders.estimatedDeliveryDate,
    }).from(orders).innerJoin(customers, eq(orders.customerId, customers.id))
      .leftJoin(townships, eq(orders.townshipId, townships.id)).where(where);
    if (!row) throw new NotFoundException(`Order '${id}' not found`);
    const historyRows = await this.database.db.select({
      fromStatus: orderStatusHistory.fromStatus,
      toStatus: orderStatusHistory.toStatus,
      reason: orderStatusHistory.reason,
      createdAt: orderStatusHistory.createdAt,
    }).from(orderStatusHistory).where(eq(orderStatusHistory.orderId, id))
      .orderBy(asc(orderStatusHistory.createdAt), asc(orderStatusHistory.id));
    const history = toShopVisibleHistory(historyRows);
    return {
      id: row.id,
      trackingCode: row.trackingCode,
      customerName: row.customerName,
      customerPhone: row.customerPhone,
      deliveryAddress: row.deliveryAddress,
      townshipName: row.townshipName,
      packagePrice: row.packagePrice,
      deliveryFee: row.deliveryFee,
      total: row.total,
      codToCollect: row.codToCollect,
      netOwedToShop: row.netOwedToShop,
      isPackagePaidToShop: row.isPackagePaidToShop,
      isFeePaidToShop: row.isFeePaidToShop,
      displayStatus: toShopDisplayStatus(row.status),
      needsAttention: shopOrderNeedsAttention(
        row.status,
        row.estimatedDeliveryDate ? getDateInTimeZone(row.estimatedDeliveryDate, this.timeZone) : null,
        today,
        row.latestReason !== null,
      ),
      createdAt: row.createdAt.toISOString(),
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      estimatedDeliveryDate: row.estimatedDeliveryDate ? getDateInTimeZone(row.estimatedDeliveryDate, this.timeZone) : null,
      history,
    };
  }

  async getDashboard(user: AuthenticatedUser, query: ShopDashboardQueryDto): Promise<ShopDashboardResponseDto> {
    const shopId = this.shopIdOrThrow(user);
    const filters = this.normalizeFilters(query);
    const conditions = this.dateConditions(filters);
    conditions.push(eq(orders.shopId, shopId));
    const where = and(...conditions);
    const [summary] = await this.database.db.select({
      received: sql<number>`count(*) filter (where ${orders.status} = 'PENDING')`,
      outForDelivery: sql<number>`count(*) filter (where ${orders.status} in ('ASSIGNED', 'AWAITING_APPROVAL'))`,
      delivered: sql<number>`count(*) filter (where ${orders.status} = 'DELIVERED')`,
      cancelled: sql<number>`count(*) filter (where ${orders.status} = 'CANCELLED')`,
      needsAttention: sql<number>`count(*) filter (where ${needsAttentionSql(this.today())})`,
      codCollected: sql<string>`coalesce(sum(case when ${orders.status} = 'DELIVERED' then ${codToCollectSql(orders)} else 0::numeric end), 0)::numeric(14, 2)::text`,
      netSettlementDelivered: sql<string>`coalesce(sum(case when ${orders.status} = 'DELIVERED' then ${netOwedToShopSql(orders)} else 0::numeric end), 0)::numeric(14, 2)::text`,
      codExpected: sql<string>`coalesce(sum(case when ${orders.status} in ('PENDING', 'ASSIGNED', 'AWAITING_APPROVAL') then ${codToCollectSql(orders)} else 0::numeric end), 0)::numeric(14, 2)::text`,
      netOwedOpen: sql<string>`coalesce(sum(case when ${orders.status} in ('PENDING', 'ASSIGNED', 'AWAITING_APPROVAL') then ${netOwedToShopSql(orders)} else 0::numeric end), 0)::numeric(14, 2)::text`,
    }).from(orders).where(where);
    const dailyRows = await this.database.db.select({
      date: sql<string>`to_char((${dateColumn(filters.dateBasis)} at time zone ${this.timeZone})::date, 'YYYY-MM-DD')`,
      status: orders.status,
      orderCount: count(),
    }).from(orders).where(where).groupBy(sql`1`, orders.status).orderBy(sql`1`, asc(orders.status));
    const dailyCounts = new Map<string, number>();
    for (const row of dailyRows) {
      const date = row.date;
      const displayStatus = toShopDisplayStatus(row.status);
      const key = `${date}|${displayStatus}`;
      dailyCounts.set(key, (dailyCounts.get(key) ?? 0) + Number(row.orderCount));
    }
    const ordersPerDayByStatus: ShopOrdersPerDayDto[] = [...dailyCounts]
      .map(([key, orderCount]) => {
        const [date, displayStatus] = key.split('|');
        if (!date || !displayStatus) throw new Error('Invalid shop dashboard grouping key');
        return { date, displayStatus: displayStatus as ShopDisplayStatus, orderCount };
      })
      .sort((left, right) => left.date.localeCompare(right.date) || left.displayStatus.localeCompare(right.displayStatus));
    return {
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      dateBasis: filters.dateBasis,
      counts: {
        received: Number(summary?.received ?? 0),
        outForDelivery: Number(summary?.outForDelivery ?? 0),
        delivered: Number(summary?.delivered ?? 0),
        cancelled: Number(summary?.cancelled ?? 0),
        needsAttention: Number(summary?.needsAttention ?? 0),
      },
      money: {
        codCollected: summary?.codCollected ?? ZERO_MONEY,
        netSettlementDelivered: summary?.netSettlementDelivered ?? ZERO_MONEY,
        codExpected: summary?.codExpected ?? ZERO_MONEY,
        netOwedOpen: summary?.netOwedOpen ?? ZERO_MONEY,
      },
      ordersPerDayByStatus,
    };
  }

  async getStatement(user: AuthenticatedUser, query: ShopStatementQueryDto): Promise<ShopStatementResponseDto> {
    const shopId = this.shopIdOrThrow(user);
    const filters = this.normalizeFilters(query);
    const statementQuery: DateRangeQueryDto = {
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      dateBasis: filters.dateBasis,
    };
    const statement = await this.statementService.getShopStatement(shopId, statementQuery);
    return {
      shopName: statement.shopName,
      dateFrom: statement.dateFrom,
      dateTo: statement.dateTo,
      dateBasis: statement.dateBasis,
      receivedCount: statement.pendingCount,
      outForDeliveryCount: statement.assignedCount + statement.awaitingApprovalCount,
      deliveredCount: statement.deliveredCount,
      cancelledCount: statement.cancelledCount,
      priceTotal: statement.priceTotal,
      feeTotal: statement.feeTotal,
      codCollected: statement.codCollected,
      codExpected: statement.codExpected,
      netOwedToShopDelivered: statement.netOwedToShopDelivered,
      pendingNetOwedToShop: statement.pendingNetOwedToShop,
      netOwedToShopTotal: this.addMoney(statement.netOwedToShopDelivered, statement.pendingNetOwedToShop),
    };
  }

  async getOrdersForExport(user: AuthenticatedUser, query: ShopOrdersExportQueryDto): Promise<{ rows: ShopExportRow[]; totals: ShopOrderListResponseDto['totals']; dateFrom: string; dateTo: string }> {
    const shopId = this.shopIdOrThrow(user);
    const filters = this.normalizeFilters(query);
    const where = this.orderConditions(shopId, filters);
    const [rows, [totals]] = await Promise.all([
      this.selectOrderRows(where, filters, 1, MAX_EXPORT_ROWS + 1),
      this.selectTotals(where),
    ]);
    if (rows.length > MAX_EXPORT_ROWS) throw new BadRequestException(`Export exceeds the ${MAX_EXPORT_ROWS.toLocaleString()} row limit`);
    return {
      rows: rows.map((row) => ({ order: this.toListItem(row) })),
      totals: {
        orderCount: Number(totals?.orderCount ?? 0),
        packagePrice: totals?.packagePrice ?? ZERO_MONEY,
        deliveryFee: totals?.deliveryFee ?? ZERO_MONEY,
        total: totals?.total ?? ZERO_MONEY,
        codToCollect: totals?.codToCollect ?? ZERO_MONEY,
        netOwedToShop: totals?.netOwedToShop ?? ZERO_MONEY,
      },
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    };
  }

  async getStatementForExport(user: AuthenticatedUser, query: ShopStatementExportQueryDto): Promise<ShopStatementResponseDto> {
    return this.getStatement(user, query);
  }

  private shopIdOrThrow(user: AuthenticatedUser): string {
    if (!user.shopId) throw new ForbiddenException('Authenticated user is not assigned to a shop');
    return user.shopId;
  }

  private today(): string {
    return getDateInTimeZone(new Date(), this.timeZone);
  }

  private normalizeFilters(query: ShopDateFilterDtoLike): NormalizedFilters {
    const today = this.today();
    const dateFrom = query.dateFrom ?? today;
    const dateTo = query.dateTo ?? today;
    if (dateFrom > dateTo) throw new BadRequestException('dateFrom must be on or before dateTo');
    if (query.timeFrom && query.timeTo && query.timeFrom > query.timeTo) {
      throw new BadRequestException('timeFrom must be on or before timeTo');
    }
    return {
      dateFrom,
      dateTo,
      dateBasis: query.dateBasis ?? 'ENTRY',
      ...('timeFrom' in query && query.timeFrom ? { timeFrom: query.timeFrom } : {}),
      ...('timeTo' in query && query.timeTo ? { timeTo: query.timeTo } : {}),
      ...('displayStatus' in query && query.displayStatus ? { displayStatus: query.displayStatus } : {}),
      ...('needsAttention' in query && query.needsAttention !== undefined ? { needsAttention: query.needsAttention } : {}),
      ...('search' in query && query.search ? { search: query.search } : {}),
    };
  }

  private dateConditions(filters: NormalizedFilters): SQL[] {
    const column = dateColumn(filters.dateBasis);
    const conditions: SQL[] = [
      sql`(${column} at time zone ${this.timeZone})::date >= ${filters.dateFrom}::date`,
      sql`(${column} at time zone ${this.timeZone})::date <= ${filters.dateTo}::date`,
    ];
    if (filters.timeFrom) conditions.push(sql`(${column} at time zone ${this.timeZone})::time >= ${filters.timeFrom}::time`);
    if (filters.timeTo) conditions.push(sql`(${column} at time zone ${this.timeZone})::time <= ${filters.timeTo}::time`);
    return conditions;
  }

  private orderConditions(shopId: string, filters: NormalizedFilters): SQL {
    const conditions = this.dateConditions(filters);
    conditions.push(eq(orders.shopId, shopId));
    if (filters.displayStatus) conditions.push(displayStatusCondition(filters.displayStatus));
    if (filters.needsAttention !== undefined) conditions.push(filters.needsAttention ? needsAttentionSql(this.today()) : sql`not ${needsAttentionSql(this.today())}`);
    if (filters.search?.trim()) {
      const search = `%${escapeLikeWildcards(filters.search.trim())}%`;
      const customerMatches = exists(this.database.db.select({ id: customers.id }).from(customers).where(and(
        eq(customers.id, orders.customerId),
        or(ilike(customers.name, search), ilike(customers.phone, search)),
      )));
      conditions.push(or(ilike(orders.trackingCode, search), customerMatches) as SQL);
    }
    return and(...conditions) ?? sql`true`;
  }

  private async selectOrderRows(where: SQL, filters: NormalizedFilters, page: number, perPage: number): Promise<ShopOrderDbRow[]> {
    const rows = await this.database.db.select({
      id: orders.id,
      trackingCode: orders.trackingCode,
      customerName: customers.name,
      customerPhone: customers.phone,
      deliveryAddress: sql<string | null>`coalesce(${orders.deliveryAddress}, ${customers.address})`,
      townshipName: townships.name,
      packagePrice: orders.packagePrice,
      deliveryFee: orders.deliveryFee,
      total: sql<string>`(${orders.packagePrice} + ${orders.deliveryFee})::numeric(14, 2)::text`,
      codToCollect: sql<string>`case when ${orders.status} in ('PENDING', 'ASSIGNED', 'AWAITING_APPROVAL', 'DELIVERED') then ${codToCollectSql(orders)} else 0::numeric end::numeric(14, 2)::text`,
      netOwedToShop: sql<string>`case when ${orders.status} in ('PENDING', 'ASSIGNED', 'AWAITING_APPROVAL', 'DELIVERED') then ${netOwedToShopSql(orders)} else 0::numeric end::numeric(14, 2)::text`,
      isPackagePaidToShop: orders.isPackagePaidToShop,
      isFeePaidToShop: orders.isFeePaidToShop,
      status: orders.status,
      latestReason: latestPostponeOrSendBackReasonSql(),
      createdAt: orders.createdAt,
      deliveredAt: orders.deliveredAt,
      estimatedDeliveryDate: orders.estimatedDeliveryDate,
    }).from(orders).innerJoin(customers, eq(orders.customerId, customers.id))
      .leftJoin(townships, eq(orders.townshipId, townships.id)).where(where)
      .orderBy(asc(dateColumn(filters.dateBasis)), asc(orders.id))
      .limit(perPage).offset((page - 1) * perPage);
    return rows.map((row) => ({
      id: row.id,
      trackingCode: row.trackingCode,
      customerName: row.customerName,
      customerPhone: row.customerPhone,
      deliveryAddress: row.deliveryAddress,
      townshipName: row.townshipName,
      packagePrice: row.packagePrice,
      deliveryFee: row.deliveryFee,
      total: row.total,
      codToCollect: row.codToCollect,
      netOwedToShop: row.netOwedToShop,
      isPackagePaidToShop: row.isPackagePaidToShop,
      isFeePaidToShop: row.isFeePaidToShop,
      status: row.status,
      latestReason: row.latestReason,
      createdAt: row.createdAt,
      deliveredAt: row.deliveredAt,
      estimatedDeliveryDate: row.estimatedDeliveryDate,
    }));
  }

  private async selectTotals(where: SQL): Promise<Array<{
    orderCount: string;
    packagePrice: string;
    deliveryFee: string;
    total: string;
    codToCollect: string;
    netOwedToShop: string;
  }>> {
    return this.database.db.select({
      orderCount: sql<string>`count(*)::text`,
      packagePrice: sql<string>`coalesce(sum(case when ${orders.status} in ('PENDING', 'ASSIGNED', 'AWAITING_APPROVAL', 'DELIVERED') then ${orders.packagePrice} else 0::numeric end), 0)::numeric(14, 2)::text`,
      deliveryFee: sql<string>`coalesce(sum(case when ${orders.status} in ('PENDING', 'ASSIGNED', 'AWAITING_APPROVAL', 'DELIVERED') then ${orders.deliveryFee} else 0::numeric end), 0)::numeric(14, 2)::text`,
      total: sql<string>`coalesce(sum(case when ${orders.status} in ('PENDING', 'ASSIGNED', 'AWAITING_APPROVAL', 'DELIVERED') then ${orders.packagePrice} + ${orders.deliveryFee} else 0::numeric end), 0)::numeric(14, 2)::text`,
      codToCollect: sql<string>`coalesce(sum(case when ${orders.status} in ('PENDING', 'ASSIGNED', 'AWAITING_APPROVAL', 'DELIVERED') then ${codToCollectSql(orders)} else 0::numeric end), 0)::numeric(14, 2)::text`,
      netOwedToShop: sql<string>`coalesce(sum(case when ${orders.status} in ('PENDING', 'ASSIGNED', 'AWAITING_APPROVAL', 'DELIVERED') then ${netOwedToShopSql(orders)} else 0::numeric end), 0)::numeric(14, 2)::text`,
    }).from(orders).where(where);
  }

  private toListItem(row: ShopOrderDbRow): ShopOrderListItemDto {
    return {
      id: row.id,
      trackingCode: row.trackingCode,
      customerName: row.customerName,
      customerPhone: row.customerPhone,
      deliveryAddress: row.deliveryAddress,
      townshipName: row.townshipName,
      packagePrice: row.packagePrice,
      deliveryFee: row.deliveryFee,
      total: row.total,
      codToCollect: row.codToCollect,
      netOwedToShop: row.netOwedToShop,
      isPackagePaidToShop: row.isPackagePaidToShop,
      isFeePaidToShop: row.isFeePaidToShop,
      displayStatus: toShopDisplayStatus(row.status),
      needsAttention: shopOrderNeedsAttention(
        row.status,
        row.estimatedDeliveryDate ? getDateInTimeZone(row.estimatedDeliveryDate, this.timeZone) : null,
        this.today(),
        row.latestReason !== null,
      ),
      createdAt: row.createdAt.toISOString(),
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      estimatedDeliveryDate: row.estimatedDeliveryDate ? getDateInTimeZone(row.estimatedDeliveryDate, this.timeZone) : null,
    };
  }

  private addMoney(left: string, right: string): string {
    const toCents = (value: string): bigint => {
      const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
      if (!match) throw new Error('Invalid SQL decimal returned for shop statement');
      const whole = BigInt(match[2] ?? '0');
      const fraction = BigInt((match[3] ?? '').padEnd(2, '0'));
      return (match[1] === '-' ? -1n : 1n) * (whole * 100n + fraction);
    };
    const cents = toCents(left) + toCents(right);
    const sign = cents < 0n ? '-' : '';
    const absolute = cents < 0n ? -cents : cents;
    return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
  }
}

type ShopDateFilterDtoLike = Pick<ShopOrdersQueryDto, 'dateFrom' | 'dateTo' | 'dateBasis'> & Partial<Pick<ShopOrdersQueryDto, 'timeFrom' | 'timeTo' | 'displayStatus' | 'needsAttention' | 'search'>>;
