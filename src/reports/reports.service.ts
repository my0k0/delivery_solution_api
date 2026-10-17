import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, count, eq, exists, gte, ilike, inArray, lte, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { DatabaseService } from '../common/database/database.service.js';
import { escapeLikeWildcards } from '../common/utils/normalize.util.js';
import { customers } from '../customers/customer.schema.js';
import { getDateInTimeZone } from '../common/utils/timezone-date.util.js';
import { orders } from '../orders/order.schema.js';
import { deliveryPartners } from '../delivery-partners/delivery-partner.schema.js';
import { riders } from '../riders/rider.schema.js';
import { roles } from '../roles/roles.schema.js';
import { shops } from '../shops/shop.schema.js';
import { townships } from '../townships/township.schema.js';
import { users } from '../users/user.schema.js';
import { ways } from '../ways/way.schema.js';
import { deriveWayFinancialState } from '../ways/way-state.util.js';
import { codToCollectSql, netOwedToShopSql } from './report-money.util.js';
import type { DateRangeQueryDto, OrderReportQueryDto, OrderReportExportQueryDto, ReportDateBasis } from './dto/report-query.dto.js';
import type {
  OrderReportResponseDto,
  OrderReportRowDto,
  OrderReportTotalsDto,
  RiderCollectionResponseDto,
  RiderCollectionRowDto,
  RiderDashboardResponseDto,
  RiderPayoutResponseDto,
  RiderPayoutRowDto,
  ShopStatementResponseDto,
  OfficeDashboardResponseDto,
} from './dto/report-response.dto.js';

const ACTIVE_STATUSES = ['PENDING', 'ASSIGNED', 'AWAITING_APPROVAL'] as const;
const MAX_EXPORT_ROWS = 50_000;
const ZERO_MONEY = '0.00';

function dateShift(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function validateDateRange(query: DateRangeQueryDto): void {
  if (query.dateFrom > query.dateTo) {
    throw new BadRequestException('dateFrom must be on or before dateTo');
  }
}

function reportDateColumn(dateBasis: ReportDateBasis): SQL {
  return dateBasis === 'DELIVERED' ? sql`${orders.deliveredAt}` : sql`${orders.createdAt}`;
}

function dateRangeConditions(
  column: SQL,
  dateFrom: string,
  dateTo: string,
  timeZone: string,
): SQL[] {
  return [
    sql`(${column} at time zone ${timeZone})::date >= ${dateFrom}::date`,
    sql`(${column} at time zone ${timeZone})::date <= ${dateTo}::date`,
  ];
}

function payableMoneyExpression(expression: SQLWrapper): SQL {
  return sql`case when ${orders.status} in ('PENDING', 'ASSIGNED', 'AWAITING_APPROVAL', 'DELIVERED') then ${expression} else 0::numeric end`;
}

function whereCondition(conditions: SQL[]): SQL {
  return and(...conditions) ?? sql`true`;
}

function wayIdsCondition(ids: readonly string[]): SQL {
  return ids.length ? inArray(ways.id, [...ids]) : sql`false`;
}

@Injectable()
export class ShopStatementService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  async getShopStatement(shopId: string, query: DateRangeQueryDto): Promise<ShopStatementResponseDto> {
    validateDateRange(query);
    const timeZone = this.config.get<string>('APP_TIMEZONE') ?? 'Asia/Yangon';
    const [shop] = await this.database.db.select({ id: shops.id, name: shops.name })
      .from(shops).where(eq(shops.id, shopId));
    if (!shop) throw new NotFoundException(`Shop '${shopId}' not found`);
    const dateColumn = reportDateColumn(query.dateBasis);
    const [totals] = await this.database.db.select({
      pendingCount: sql<number>`count(*) filter (where ${orders.status} = 'PENDING')`,
      assignedCount: sql<number>`count(*) filter (where ${orders.status} = 'ASSIGNED')`,
      awaitingApprovalCount: sql<number>`count(*) filter (where ${orders.status} = 'AWAITING_APPROVAL')`,
      deliveredCount: sql<number>`count(*) filter (where ${orders.status} = 'DELIVERED')`,
      cancelledCount: sql<number>`count(*) filter (where ${orders.status} = 'CANCELLED')`,
      priceTotal: sql<string>`coalesce(sum(${payableMoneyExpression(orders.packagePrice)}), 0)::numeric(14, 2)::text`,
      feeTotal: sql<string>`coalesce(sum(${payableMoneyExpression(orders.deliveryFee)}), 0)::numeric(14, 2)::text`,
      codCollected: sql<string>`coalesce(sum(case when ${orders.status} = 'DELIVERED' then ${codToCollectSql(orders)} else 0::numeric end), 0)::numeric(14, 2)::text`,
      codExpected: sql<string>`coalesce(sum(case when ${orders.status} in ('PENDING', 'ASSIGNED', 'AWAITING_APPROVAL') then ${codToCollectSql(orders)} else 0::numeric end), 0)::numeric(14, 2)::text`,
      netOwedToShopDelivered: sql<string>`coalesce(sum(case when ${orders.status} = 'DELIVERED' then ${netOwedToShopSql(orders)} else 0::numeric end), 0)::numeric(14, 2)::text`,
      pendingNetOwedToShop: sql<string>`coalesce(sum(case when ${orders.status} in ('PENDING', 'ASSIGNED', 'AWAITING_APPROVAL') then ${netOwedToShopSql(orders)} else 0::numeric end), 0)::numeric(14, 2)::text`,
    }).from(orders).where(and(
      eq(orders.shopId, shopId),
      ...dateRangeConditions(dateColumn, query.dateFrom, query.dateTo, timeZone),
    ));
    return {
      shopId: shop.id,
      shopName: shop.name,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      dateBasis: query.dateBasis,
      pendingCount: Number(totals?.pendingCount ?? 0),
      assignedCount: Number(totals?.assignedCount ?? 0),
      awaitingApprovalCount: Number(totals?.awaitingApprovalCount ?? 0),
      deliveredCount: Number(totals?.deliveredCount ?? 0),
      cancelledCount: Number(totals?.cancelledCount ?? 0),
      priceTotal: totals?.priceTotal ?? ZERO_MONEY,
      feeTotal: totals?.feeTotal ?? ZERO_MONEY,
      codCollected: totals?.codCollected ?? ZERO_MONEY,
      codExpected: totals?.codExpected ?? ZERO_MONEY,
      netOwedToShopDelivered: totals?.netOwedToShopDelivered ?? ZERO_MONEY,
      pendingNetOwedToShop: totals?.pendingNetOwedToShop ?? ZERO_MONEY,
    };
  }
}

@Injectable()
export class ReportsService {
  private readonly timeZone: string;

  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
    private readonly shopStatementService: ShopStatementService,
  ) {
    this.timeZone = this.config.get<string>('APP_TIMEZONE') ?? 'Asia/Yangon';
  }

  async getOrders(query: OrderReportQueryDto): Promise<OrderReportResponseDto> {
    validateDateRange(query);
    const conditions = this.orderConditions(query);
    const where = whereCondition(conditions);
    const [rows, totalRow] = await Promise.all([
      this.orderRows(where, query.page, query.perPage),
      this.orderTotals(where),
    ]);
    const total = Number(totalRow.orderCount);
    return {
      data: rows,
      meta: { page: query.page, perPage: query.perPage, total, totalPages: Math.ceil(total / query.perPage) },
      totals: { ...totalRow, orderCount: total },
    };
  }

  async getAllOrdersForExport(query: OrderReportExportQueryDto): Promise<OrderReportRowDto[]> {
    validateDateRange(query);
    const rows = await this.orderRows(whereCondition(this.orderConditions(query)), 1, MAX_EXPORT_ROWS + 1);
    if (rows.length > MAX_EXPORT_ROWS) throw new BadRequestException(`Export exceeds the ${MAX_EXPORT_ROWS.toLocaleString()} row limit`);
    return rows;
  }

  async getOrderReportTotalsForExport(query: OrderReportExportQueryDto): Promise<OrderReportTotalsDto> {
    validateDateRange(query);
    const totals = await this.orderTotals(whereCondition(this.orderConditions(query)));
    return { ...totals, orderCount: Number(totals.orderCount) };
  }

  async getShopStatement(shopId: string, query: DateRangeQueryDto): Promise<ShopStatementResponseDto> {
    return this.shopStatementService.getShopStatement(shopId, query);
  }

  async getRiderCollection(query: DateRangeQueryDto & { riderId?: string }): Promise<RiderCollectionResponseDto> {
    validateDateRange(query);
    const dailyDate = sql<string>`to_char((${orders.deliveredAt} at time zone ${this.timeZone})::date, 'YYYY-MM-DD')`;
    const conditions: SQL[] = [
      sql`${orders.deliveredAt} is not null`,
      ...dateRangeConditions(sql`${orders.deliveredAt}`, query.dateFrom, query.dateTo, this.timeZone),
      inArray(orders.status, ['DELIVERED', 'AWAITING_APPROVAL']),
    ];
    if (query.riderId) conditions.push(eq(orders.riderId, query.riderId));
    const rows = await this.database.db.select({
      riderId: riders.id,
      riderName: users.name,
      date: dailyDate,
      deliveredOrderCount: sql<number>`count(*) filter (where ${orders.status} = 'DELIVERED')`,
      awaitingApprovalOrderCount: sql<number>`count(*) filter (where ${orders.status} = 'AWAITING_APPROVAL')`,
      expectedCodToHandBack: sql<string>`coalesce(sum(case when ${orders.status} = 'DELIVERED' then ${codToCollectSql(orders)} else 0::numeric end), 0)::numeric(14, 2)::text`,
      awaitingApprovalCod: sql<string>`coalesce(sum(case when ${orders.status} = 'AWAITING_APPROVAL' then ${codToCollectSql(orders)} else 0::numeric end), 0)::numeric(14, 2)::text`,
    }).from(orders).innerJoin(riders, eq(orders.riderId, riders.id))
      .innerJoin(users, eq(riders.userId, users.id))
      .where(and(...conditions)).groupBy(riders.id, users.name, sql`3`)
      .orderBy(sql`3`, asc(users.name));
    const data = rows.map((row): RiderCollectionRowDto => ({
      ...row,
      deliveredOrderCount: Number(row.deliveredOrderCount),
      awaitingApprovalOrderCount: Number(row.awaitingApprovalOrderCount),
    }));
    const [totals] = await this.database.db.select({
      deliveredOrderCount: sql<number>`count(*) filter (where ${orders.status} = 'DELIVERED')`,
      awaitingApprovalOrderCount: sql<number>`count(*) filter (where ${orders.status} = 'AWAITING_APPROVAL')`,
      expectedCodToHandBack: sql<string>`coalesce(sum(case when ${orders.status} = 'DELIVERED' then ${codToCollectSql(orders)} else 0::numeric end), 0)::numeric(14, 2)::text`,
      awaitingApprovalCod: sql<string>`coalesce(sum(case when ${orders.status} = 'AWAITING_APPROVAL' then ${codToCollectSql(orders)} else 0::numeric end), 0)::numeric(14, 2)::text`,
    }).from(orders).where(and(...conditions));
    return {
      data,
      totals: {
        deliveredOrderCount: Number(totals?.deliveredOrderCount ?? 0),
        awaitingApprovalOrderCount: Number(totals?.awaitingApprovalOrderCount ?? 0),
        expectedCodToHandBack: totals?.expectedCodToHandBack ?? ZERO_MONEY,
        awaitingApprovalCod: totals?.awaitingApprovalCod ?? ZERO_MONEY,
      },
    };
  }

  async getRiderPayout(query: DateRangeQueryDto & { riderId?: string }): Promise<RiderPayoutResponseDto> {
    validateDateRange(query);
    const conditions: SQL[] = [gte(ways.wayDate, query.dateFrom), lte(ways.wayDate, query.dateTo)];
    if (query.riderId) conditions.push(eq(ways.riderId, query.riderId));
    const wayRows = await this.database.db.select({
      wayId: ways.id,
      riderId: riders.id,
      riderName: users.name,
      date: ways.wayDate,
      rate: ways.commissionRate,
      isPaidWithoutDelivery: ways.isPaidWithoutDelivery,
      orderCount: sql<number>`count(${orders.id})`,
      deliveredCount: sql<number>`count(${orders.id}) filter (where ${orders.status} = 'DELIVERED')`,
    }).from(ways).innerJoin(riders, eq(ways.riderId, riders.id))
      .innerJoin(users, eq(riders.userId, users.id))
      .leftJoin(orders, eq(orders.wayId, ways.id)).where(and(...conditions))
      .groupBy(ways.id, riders.id, users.name).orderBy(asc(ways.wayDate), asc(users.name));

    const stateByWayId = new Map<string, ReturnType<typeof deriveWayFinancialState>['state']>();
    for (const row of wayRows) {
      const financialState = deriveWayFinancialState(Number(row.orderCount), Number(row.deliveredCount), row.isPaidWithoutDelivery, row.rate);
      stateByWayId.set(row.wayId, financialState.state);
    }
    const earnedWayIds = [...stateByWayId].filter(([, state]) => state === 'EARNED').map(([id]) => id);
    const pendingWayIds = [...stateByWayId].filter(([, state]) => state === 'PENDING_APPROVAL').map(([id]) => id);
    const paidAnywayWayIds = [...stateByWayId].filter(([, state]) => state === 'PAID_ANYWAY').map(([id]) => id);
    const earnedCondition = wayIdsCondition(earnedWayIds);
    const pendingCondition = wayIdsCondition(pendingWayIds);
    const paidAnywayCondition = wayIdsCondition(paidAnywayWayIds);
    const [groupedRows, [totals]] = await Promise.all([
      this.database.db.select({
        riderId: riders.id,
        riderName: users.name,
        date: ways.wayDate,
        wayCount: sql<number>`count(*)`,
        rateTotal: sql<string>`coalesce(sum(${ways.commissionRate}), 0)::numeric(14, 2)::text`,
        earnedCount: sql<number>`count(*) filter (where ${earnedCondition})`,
        earnedAmount: sql<string>`coalesce(sum(case when ${earnedCondition} then ${ways.commissionRate} else 0::numeric end), 0)::numeric(14, 2)::text`,
        pendingApprovalCount: sql<number>`count(*) filter (where ${pendingCondition})`,
        pendingApprovalAmount: sql<string>`coalesce(sum(case when ${pendingCondition} then ${ways.commissionRate} else 0::numeric end), 0)::numeric(14, 2)::text`,
        paidAnywayCount: sql<number>`count(*) filter (where ${paidAnywayCondition})`,
        paidAnywayAmount: sql<string>`coalesce(sum(case when ${paidAnywayCondition} then ${ways.commissionRate} else 0::numeric end), 0)::numeric(14, 2)::text`,
        overrideWayCount: sql<number>`count(*) filter (where ${paidAnywayCondition})`,
      }).from(ways).innerJoin(riders, eq(ways.riderId, riders.id))
        .innerJoin(users, eq(riders.userId, users.id)).where(and(...conditions))
        .groupBy(riders.id, users.name, ways.wayDate).orderBy(asc(ways.wayDate), asc(users.name)),
      this.database.db.select({
        wayCount: sql<number>`count(*)`,
        rateTotal: sql<string>`coalesce(sum(${ways.commissionRate}), 0)::numeric(14, 2)::text`,
        earnedCount: sql<number>`count(*) filter (where ${earnedCondition})`,
        earnedAmount: sql<string>`coalesce(sum(case when ${earnedCondition} then ${ways.commissionRate} else 0::numeric end), 0)::numeric(14, 2)::text`,
        pendingApprovalCount: sql<number>`count(*) filter (where ${pendingCondition})`,
        pendingApprovalAmount: sql<string>`coalesce(sum(case when ${pendingCondition} then ${ways.commissionRate} else 0::numeric end), 0)::numeric(14, 2)::text`,
        paidAnywayCount: sql<number>`count(*) filter (where ${paidAnywayCondition})`,
        paidAnywayAmount: sql<string>`coalesce(sum(case when ${paidAnywayCondition} then ${ways.commissionRate} else 0::numeric end), 0)::numeric(14, 2)::text`,
        overrideWayCount: sql<number>`count(*) filter (where ${paidAnywayCondition})`,
      }).from(ways).where(and(...conditions)),
    ]);
    const data: RiderPayoutRowDto[] = groupedRows.map((row) => ({
      ...row,
      wayCount: Number(row.wayCount),
      earnedCount: Number(row.earnedCount),
      pendingApprovalCount: Number(row.pendingApprovalCount),
      paidAnywayCount: Number(row.paidAnywayCount),
      overrideWayCount: Number(row.overrideWayCount),
    }));
    return {
      data,
      totals: {
        wayCount: Number(totals?.wayCount ?? 0),
        rateTotal: totals?.rateTotal ?? ZERO_MONEY,
        earnedCount: Number(totals?.earnedCount ?? 0),
        earnedAmount: totals?.earnedAmount ?? ZERO_MONEY,
        pendingApprovalCount: Number(totals?.pendingApprovalCount ?? 0),
        pendingApprovalAmount: totals?.pendingApprovalAmount ?? ZERO_MONEY,
        paidAnywayCount: Number(totals?.paidAnywayCount ?? 0),
        paidAnywayAmount: totals?.paidAnywayAmount ?? ZERO_MONEY,
        overrideWayCount: Number(totals?.overrideWayCount ?? 0),
      },
    };
  }

  async getOfficeDashboard(query: DateRangeQueryDto): Promise<OfficeDashboardResponseDto> {
    validateDateRange(query);
    const today = getDateInTimeZone(new Date(), this.timeZone);
    const todayOrders = await this.database.db.select({
      todayOrderCount: sql<number>`count(*) filter (where (${orders.createdAt} at time zone ${this.timeZone})::date = ${today}::date)`,
      awaitingApprovalCount: sql<number>`count(*) filter (where ${orders.status} = 'AWAITING_APPROVAL')`,
      codExpected: sql<string>`coalesce(sum(case when ${orders.status} in ('PENDING', 'ASSIGNED', 'AWAITING_APPROVAL') and (${orders.createdAt} at time zone ${this.timeZone})::date = ${today}::date then ${codToCollectSql(orders)} else 0::numeric end), 0)::numeric(14, 2)::text`,
      feeIncome: sql<string>`coalesce(sum(case when ${orders.status} = 'DELIVERED' and (${orders.deliveredAt} at time zone ${this.timeZone})::date = ${today}::date then ${orders.deliveryFee} else 0::numeric end), 0)::numeric(14, 2)::text`,
      delayedCount: sql<number>`count(*) filter (where ${orders.status} in ('PENDING', 'ASSIGNED', 'AWAITING_APPROVAL') and ${orders.estimatedDeliveryDate} < ${today}::date)`,
    }).from(orders);
    const conditions = dateRangeConditions(reportDateColumn(query.dateBasis), query.dateFrom, query.dateTo, this.timeZone);
    const orderDailyRows = await this.database.db.select({
      date: sql<string>`to_char((${reportDateColumn(query.dateBasis)} at time zone ${this.timeZone})::date, 'YYYY-MM-DD')`,
      status: orders.status,
      orderCount: count(),
    }).from(orders).where(and(...conditions)).groupBy(sql`1`, orders.status).orderBy(sql`1`, asc(orders.status));

    const financialDailyRows = await this.database.db.select({
      date: sql<string>`to_char((${orders.deliveredAt} at time zone ${this.timeZone})::date, 'YYYY-MM-DD')`,
      feeIncome: sql<string>`coalesce(sum(${orders.deliveryFee}), 0)::numeric(14, 2)::text`,
      partnerCost: sql<string>`coalesce(sum(${orders.partnerFee}), 0)::numeric(14, 2)::text`,
    }).from(orders).where(and(
      eq(orders.status, 'DELIVERED'),
      sql`${orders.deliveredAt} is not null`,
      ...dateRangeConditions(sql`${orders.deliveredAt}`, query.dateFrom, query.dateTo, this.timeZone),
    )).groupBy(sql`1`).orderBy(sql`1`);
    const payoutByDate = await this.earnedCommissionByDate(query.dateFrom, query.dateTo);
    const dates = new Set([...financialDailyRows.map((row) => row.date), ...payoutByDate.keys()]);
    const dailyValues = [...dates].sort().map((date) => {
      const orderMoney = financialDailyRows.find((row) => row.date === date);
      return sql`(${date}::date, ${(orderMoney?.feeIncome ?? ZERO_MONEY)}::numeric, ${(orderMoney?.partnerCost ?? ZERO_MONEY)}::numeric, ${(payoutByDate.get(date) ?? ZERO_MONEY)}::numeric)`;
    });
    const financialSeries = dailyValues.length
      ? await this.database.db.execute<{
          date: string;
          feeIncome: string;
          partnerCost: string;
          commissionEarned: string;
          margin: string;
        }>(sql`select to_char(daily.report_date, 'YYYY-MM-DD') as date,
          daily.fee_income::numeric(14, 2)::text as "feeIncome",
          daily.partner_cost::numeric(14, 2)::text as "partnerCost",
          daily.commission_earned::numeric(14, 2)::text as "commissionEarned",
          (daily.fee_income - daily.partner_cost - daily.commission_earned)::numeric(14, 2)::text as margin
        from (values ${sql.join(dailyValues, sql`, `)}) as daily(report_date, fee_income, partner_cost, commission_earned)
        order by daily.report_date`)
      : [];
    const topShops = await this.database.db.select({
      shopId: shops.id,
      shopName: shops.name,
      orderCount: count(),
    }).from(orders).innerJoin(shops, eq(orders.shopId, shops.id))
      .where(and(...conditions)).groupBy(shops.id, shops.name)
      .orderBy(sql`count(*) desc`, asc(shops.name)).limit(10);
    const townshipRows = await this.database.db.select({
      townshipId: townships.id,
      townshipName: townships.name,
      deliveredCount: sql<number>`count(*) filter (where ${orders.status} = 'DELIVERED')`,
      cancelledCount: sql<number>`count(*) filter (where ${orders.status} = 'CANCELLED')`,
    }).from(orders).innerJoin(townships, eq(orders.townshipId, townships.id))
      .where(and(...conditions)).groupBy(townships.id, townships.name).orderBy(asc(townships.name));
    const townshipSuccessRates = townshipRows.map((row) => {
      const deliveredCount = Number(row.deliveredCount);
      const cancelledCount = Number(row.cancelledCount);
      const denominator = deliveredCount + cancelledCount;
      return {
        townshipId: row.townshipId,
        townshipName: row.townshipName,
        deliveredCount,
        cancelledCount,
        successRate: denominator === 0 ? '0.00' : ((deliveredCount * 10000) / denominator / 100).toFixed(2),
      };
    });
    const [pendingAge] = await this.database.db.select({
      averageDays: sql<string>`coalesce(avg(extract(epoch from (now() - ${orders.createdAt})) / 86400), 0)::numeric(12, 2)::text`,
    }).from(orders).where(and(
      inArray(orders.status, [...ACTIVE_STATUSES]),
      ...dateRangeConditions(sql`${orders.createdAt}`, query.dateFrom, query.dateTo, this.timeZone),
    ));
    const metrics = todayOrders[0];
    return {
      today,
      kpis: [
        { key: 'todaysOrders', count: Number(metrics?.todayOrderCount ?? 0), amount: ZERO_MONEY },
        { key: 'awaitingApproval', count: Number(metrics?.awaitingApprovalCount ?? 0), amount: ZERO_MONEY },
        { key: 'codToCollectToday', count: 0, amount: metrics?.codExpected ?? ZERO_MONEY },
        { key: 'feeIncomeToday', count: 0, amount: metrics?.feeIncome ?? ZERO_MONEY },
        { key: 'delayedOrders', count: Number(metrics?.delayedCount ?? 0), amount: ZERO_MONEY },
      ],
      ordersPerDayByStatus: orderDailyRows.map((row) => ({ ...row, orderCount: Number(row.orderCount) })),
      feeIncomeVsPartnerCostVsCommission: Array.from(financialSeries),
      topShops: topShops.map((row) => ({ ...row, orderCount: Number(row.orderCount) })),
      townshipSuccessRates,
      averagePendingAgeDays: pendingAge?.averageDays ?? '0.00',
    };
  }

  async getRiderDashboard(userId: string): Promise<RiderDashboardResponseDto> {
    const [rider] = await this.database.db.select({ id: riders.id })
      .from(riders).innerJoin(users, eq(riders.userId, users.id))
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(and(eq(users.id, userId), eq(roles.name, 'RIDER')));
    if (!rider) throw new ForbiddenException('Rider dashboard is available to riders only');
    const today = getDateInTimeZone(new Date(), this.timeZone);
    const monthFrom = `${today.slice(0, 7)}-01`;
    const weekDay = new Date(`${today}T00:00:00.000Z`).getUTCDay();
    const weekFrom = dateShift(today, -(weekDay === 0 ? 6 : weekDay - 1));
    const riderWays = await this.database.db.select({
      id: ways.id,
      wayDate: ways.wayDate,
      commissionRate: ways.commissionRate,
      isPaidWithoutDelivery: ways.isPaidWithoutDelivery,
      orderCount: sql<number>`count(${orders.id})`,
      deliveredCount: sql<number>`count(${orders.id}) filter (where ${orders.status} = 'DELIVERED')`,
    }).from(ways).leftJoin(orders, eq(orders.wayId, ways.id))
      .where(and(eq(ways.riderId, rider.id), gte(ways.wayDate, monthFrom), lte(ways.wayDate, today)))
      .groupBy(ways.id).orderBy(asc(ways.wayDate));
    const stateByWayId = new Map<string, ReturnType<typeof deriveWayFinancialState>['state']>();
    for (const way of riderWays) {
      const state = deriveWayFinancialState(Number(way.orderCount), Number(way.deliveredCount), way.isPaidWithoutDelivery, way.commissionRate);
      stateByWayId.set(way.id, state.state);
    }
    const earnedWayIds = [...stateByWayId].filter(([, state]) => state === 'EARNED').map(([id]) => id);
    const pendingWayIds = [...stateByWayId].filter(([, state]) => state === 'PENDING_APPROVAL').map(([id]) => id);
    const [commissionTotals] = await this.database.db.select({
      commissionEarned: sql<string>`coalesce(sum(case when ${wayIdsCondition(earnedWayIds)} then ${ways.commissionRate} else 0::numeric end), 0)::numeric(14, 2)::text`,
      commissionPending: sql<string>`coalesce(sum(case when ${wayIdsCondition(pendingWayIds)} then ${ways.commissionRate} else 0::numeric end), 0)::numeric(14, 2)::text`,
    }).from(ways).where(and(
      eq(ways.riderId, rider.id),
      gte(ways.wayDate, monthFrom),
      lte(ways.wayDate, today),
    ));
    const deliveredCod = await this.database.db.select({
      amount: sql<string>`coalesce(sum(${codToCollectSql(orders)}), 0)::numeric(14, 2)::text`,
    }).from(orders).where(and(
      eq(orders.riderId, rider.id),
      eq(orders.status, 'DELIVERED'),
      ...dateRangeConditions(sql`${orders.deliveredAt}`, today, today, this.timeZone),
    ));
    return {
      today,
      todayWayCount: riderWays.filter((way) => way.wayDate === today).length,
      weekWayCount: riderWays.filter((way) => way.wayDate >= weekFrom).length,
      monthWayCount: riderWays.length,
      commissionEarned: commissionTotals?.commissionEarned ?? ZERO_MONEY,
      commissionPending: commissionTotals?.commissionPending ?? ZERO_MONEY,
      ordersPerWay: riderWays.map((way) => ({ wayId: way.id, date: way.wayDate, orderCount: Number(way.orderCount) })),
      codToHandBack: deliveredCod[0]?.amount ?? ZERO_MONEY,
    };
  }

  private orderConditions(query: OrderReportQueryDto | OrderReportExportQueryDto): SQL[] {
    const conditions: SQL[] = dateRangeConditions(reportDateColumn(query.dateBasis), query.dateFrom, query.dateTo, this.timeZone);
    if (query.search?.trim()) {
      const search = `%${escapeLikeWildcards(query.search.trim())}%`;
      const customerMatches = exists(
        this.database.db.select({ id: customers.id }).from(customers).where(and(
          eq(customers.id, orders.customerId),
          or(ilike(customers.name, search), ilike(customers.phone, search)),
        )),
      );
      conditions.push(or(ilike(orders.trackingCode, search), customerMatches) as SQL);
    }
    if (query.shopId) conditions.push(eq(orders.shopId, query.shopId));
    if (query.townshipId) conditions.push(eq(orders.townshipId, query.townshipId));
    if (query.status) conditions.push(eq(orders.status, query.status));
    if (query.assigneeId) conditions.push(sql`(${orders.riderId} = ${query.assigneeId} or ${orders.partnerId} = ${query.assigneeId})`);
    return conditions;
  }

  private async orderRows(where: SQL, page: number, perPage: number): Promise<OrderReportRowDto[]> {
    const codExpression = sql`case when ${orders.status} = 'DELIVERED' or ${orders.status} in ('PENDING', 'ASSIGNED', 'AWAITING_APPROVAL') then ${codToCollectSql(orders)} else 0::numeric end`;
    const netExpression = sql`case when ${orders.status} = 'DELIVERED' or ${orders.status} in ('PENDING', 'ASSIGNED', 'AWAITING_APPROVAL') then ${netOwedToShopSql(orders)} else 0::numeric end`;
    const rows = await this.database.db.select({
      id: orders.id,
      trackingCode: orders.trackingCode,
      shopId: shops.id,
      shopName: shops.name,
      customerName: customers.name,
      customerPhone: customers.phone,
      deliveryAddress: orders.deliveryAddress,
      townshipId: townships.id,
      townshipName: townships.name,
      status: orders.status,
      assigneeType: orders.assigneeType,
      assigneeId: sql<string | null>`coalesce(${riders.id}, ${orders.partnerId})`,
      assigneeName: sql<string | null>`coalesce(${users.name}, ${deliveryPartners.name})`,
      packagePrice: sql<string>`case when ${orders.status} in ('PENDING', 'ASSIGNED', 'AWAITING_APPROVAL', 'DELIVERED') then ${orders.packagePrice} else 0::numeric end::numeric(14, 2)::text`,
      deliveryFee: sql<string>`case when ${orders.status} in ('PENDING', 'ASSIGNED', 'AWAITING_APPROVAL', 'DELIVERED') then ${orders.deliveryFee} else 0::numeric end::numeric(14, 2)::text`,
      codToCollect: sql<string>`${codExpression}::numeric(14, 2)::text`,
      netOwedToShop: sql<string>`${netExpression}::numeric(14, 2)::text`,
      partnerFee: sql<string>`case when ${orders.status} in ('PENDING', 'ASSIGNED', 'AWAITING_APPROVAL', 'DELIVERED') then ${orders.partnerFee} else 0::numeric end::numeric(14, 2)::text`,
      createdAt: orders.createdAt,
      deliveredAt: orders.deliveredAt,
    }).from(orders).innerJoin(shops, eq(orders.shopId, shops.id))
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .leftJoin(townships, eq(orders.townshipId, townships.id))
      .leftJoin(riders, eq(orders.riderId, riders.id))
      .leftJoin(users, eq(riders.userId, users.id))
      .leftJoin(deliveryPartners, eq(orders.partnerId, deliveryPartners.id))
      .where(where).orderBy(asc(orders.createdAt), asc(orders.id))
      .limit(perPage).offset((page - 1) * perPage);
    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
    }));
  }

  private async orderTotals(where: SQL): Promise<Omit<OrderReportTotalsDto, 'orderCount'> & { orderCount: string }> {
    const [row] = await this.database.db.select({
      orderCount: sql<string>`count(*)::text`,
      packagePrice: sql<string>`coalesce(sum(${payableMoneyExpression(orders.packagePrice)}), 0)::numeric(14, 2)::text`,
      deliveryFee: sql<string>`coalesce(sum(${payableMoneyExpression(orders.deliveryFee)}), 0)::numeric(14, 2)::text`,
      codToCollect: sql<string>`coalesce(sum(case when ${orders.status} in ('PENDING', 'ASSIGNED', 'AWAITING_APPROVAL', 'DELIVERED') then ${codToCollectSql(orders)} else 0::numeric end), 0)::numeric(14, 2)::text`,
      netOwedToShop: sql<string>`coalesce(sum(case when ${orders.status} in ('PENDING', 'ASSIGNED', 'AWAITING_APPROVAL', 'DELIVERED') then ${netOwedToShopSql(orders)} else 0::numeric end), 0)::numeric(14, 2)::text`,
      partnerFee: sql<string>`coalesce(sum(${payableMoneyExpression(orders.partnerFee)}), 0)::numeric(14, 2)::text`,
    }).from(orders).where(where);
    return {
      orderCount: row?.orderCount ?? '0',
      packagePrice: row?.packagePrice ?? ZERO_MONEY,
      deliveryFee: row?.deliveryFee ?? ZERO_MONEY,
      codToCollect: row?.codToCollect ?? ZERO_MONEY,
      netOwedToShop: row?.netOwedToShop ?? ZERO_MONEY,
      partnerFee: row?.partnerFee ?? ZERO_MONEY,
    };
  }

  private async earnedCommissionByDate(dateFrom: string, dateTo: string): Promise<Map<string, string>> {
    const wayRows = await this.database.db.select({
      wayId: ways.id,
      wayDate: ways.wayDate,
      rate: ways.commissionRate,
      isPaidWithoutDelivery: ways.isPaidWithoutDelivery,
      orderCount: sql<number>`count(${orders.id})`,
      deliveredCount: sql<number>`count(${orders.id}) filter (where ${orders.status} = 'DELIVERED')`,
    }).from(ways).leftJoin(orders, eq(orders.wayId, ways.id))
      .where(and(gte(ways.wayDate, dateFrom), lte(ways.wayDate, dateTo)))
      .groupBy(ways.id).orderBy(asc(ways.wayDate));
    const earnedWayIds: string[] = [];
    for (const way of wayRows) {
      const state = deriveWayFinancialState(Number(way.orderCount), Number(way.deliveredCount), way.isPaidWithoutDelivery, way.rate);
      if (state.state === 'EARNED') earnedWayIds.push(way.wayId);
    }
    const earnedCondition = wayIdsCondition(earnedWayIds);
    const dailyTotals = await this.database.db.select({
      date: ways.wayDate,
      amount: sql<string>`coalesce(sum(case when ${earnedCondition} then ${ways.commissionRate} else 0::numeric end), 0)::numeric(14, 2)::text`,
    }).from(ways).where(and(
      gte(ways.wayDate, dateFrom),
      lte(ways.wayDate, dateTo),
      earnedCondition,
    )).groupBy(ways.wayDate).orderBy(asc(ways.wayDate));
    return new Map(dailyTotals.map((row) => [row.date, row.amount]));
  }
}
