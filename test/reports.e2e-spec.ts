import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/setup-app.js';
import { DatabaseService } from '../src/common/database/database.service.js';
import { hashPassword } from '../src/common/utils/password.util.js';
import { getDateInTimeZone } from '../src/common/utils/timezone-date.util.js';
import { customers } from '../src/customers/customer.schema.js';
import { permissions } from '../src/permissions/permissions.schema.js';
import { role_permissions } from '../src/roles/role-permissions.schema.js';
import { roles } from '../src/roles/roles.schema.js';
import { shops } from '../src/shops/shop.schema.js';
import { townships } from '../src/townships/township.schema.js';
import { users } from '../src/users/user.schema.js';
import { orders } from '../src/orders/order.schema.js';
import { orderStatusHistory } from '../src/orders/order-status-history.schema.js';
import { riders } from '../src/riders/rider.schema.js';

describe('Phase D reports and dashboards (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let adminToken = '';
  let officerToken = '';
  let riderToken = '';
  let secondRiderToken = '';
  let shopToken = '';
  let shopId = '';
  let customerId = '';
  let riderId = '';
  let secondRiderId = '';
  let officerRoleId = '';
  let previousOfficerGrants: string[] = [];
  const createdUserIds: string[] = [];
  const orderIds: string[] = [];
  const townshipIds: string[] = [];
  const run = Date.now();

  function shiftDate(date: string, days: number): string {
    const shifted = new Date(`${date}T00:00:00.000Z`);
    shifted.setUTCDate(shifted.getUTCDate() + days);
    return shifted.toISOString().slice(0, 10);
  }

  function sumMoney(values: string[]): string {
    const cents = values.reduce((total, value) => {
      const [whole = '0', fraction = '00'] = value.split('.');
      return total + BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    }, 0n);
    return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
  }

  function subtractMoney(left: string, right: string): string {
    const toCents = (value: string): bigint => {
      const [whole = '0', fraction = '00'] = value.split('.');
      const sign = whole.startsWith('-') ? -1n : 1n;
      return sign * (BigInt(whole.replace('-', '')) * 100n + BigInt(fraction.padEnd(2, '0')));
    };
    const cents = toCents(left) - toCents(right);
    const sign = cents < 0n ? '-' : '';
    const absolute = cents < 0n ? -cents : cents;
    return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
  }

  async function login(email: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login')
      .send({ email, password }).expect(200);
    return response.body.accessToken as string;
  }

  async function createOrder(input: {
    riderId?: string | null;
    packagePrice: string;
    deliveryFee: string;
    isPackagePaidToShop?: boolean;
    isFeePaidToShop?: boolean;
    estimatedDeliveryDate?: string;
  }): Promise<{ id: string; trackingCode: string; commissionFee: string }> {
    const response = await request(app.getHttpServer()).post('/api/v1/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        shopId,
        customerId,
        townshipId: townshipIds[0],
        riderId: input.riderId,
        packagePrice: input.packagePrice,
        deliveryFee: input.deliveryFee,
        isPackagePaidToShop: input.isPackagePaidToShop ?? false,
        isFeePaidToShop: input.isFeePaidToShop ?? false,
        estimatedDeliveryDate: input.estimatedDeliveryDate,
        deliveryAddress: '-2',
      }).expect(201);
    const result = {
      id: response.body.id as string,
      trackingCode: response.body.trackingCode as string,
      commissionFee: response.body.commissionFee as string,
    };
    orderIds.push(result.id);
    return result;
  }

  beforeAll(async () => {
    const moduleReference = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleReference.createNestApplication();
    setupApp(app);
    await app.init();
    database = app.get(DatabaseService);

    const [adminRole, officerRole, riderRole, shopRole] = await Promise.all([
      database.db.query.roles.findFirst({ where: eq(roles.name, 'ADMIN') }),
      database.db.query.roles.findFirst({ where: eq(roles.name, 'OFFICER') }),
      database.db.query.roles.findFirst({ where: eq(roles.name, 'RIDER') }),
      database.db.query.roles.findFirst({ where: eq(roles.name, 'SHOP') }),
    ]);
    if (!adminRole || !officerRole || !riderRole || !shopRole) throw new Error('Run db:seed before the e2e suite');
    officerRoleId = officerRole.id;
    const oldGrants = await database.db.select({ permissionId: role_permissions.permissionId })
      .from(role_permissions).where(eq(role_permissions.roleId, officerRole.id));
    previousOfficerGrants = oldGrants.map((grant) => grant.permissionId);
    const exportPermission = await database.db.query.permissions.findFirst({
      where: eq(permissions.name, 'reports.export'), columns: { id: true },
    });
    if (exportPermission) {
      await database.db.delete(role_permissions).where(and(
        eq(role_permissions.roleId, officerRole.id),
        eq(role_permissions.permissionId, exportPermission.id),
      ));
    }

    const [admin, officer, shopUser] = await database.db.insert(users).values([
      { name: 'Reports E2E Admin', email: `reports-admin-${run}@e2e.local`, passwordHash: await hashPassword('admin-password'), roleId: adminRole.id },
      { name: 'Reports E2E Officer', email: `reports-officer-${run}@e2e.local`, passwordHash: await hashPassword('officer-password'), roleId: officerRole.id },
      { name: 'Reports E2E Shop', email: `reports-shop-${run}@e2e.local`, passwordHash: await hashPassword('shop-password'), roleId: shopRole.id },
    ]).returning({ id: users.id, email: users.email });
    createdUserIds.push(admin.id, officer.id, shopUser.id);

    const [shop] = await database.db.insert(shops).values({
      name: '@x',
      channelType: 'TELEGRAM',
      channelName: `ReportsShop${run}`,
    }).returning({ id: shops.id });
    shopId = shop.id;
    await database.db.update(users).set({ shopId }).where(eq(users.id, shopUser.id));
    const [customer] = await database.db.insert(customers).values({
      name: '=HYPERLINK("https://bad")', phone: '+1 555', address: 'Customer address',
    }).returning({ id: customers.id });
    customerId = customer.id;
    const [township] = await database.db.insert(townships).values({
      name: '\tformula', defaultDeliveryFee: '3500.00', defaultCommissionFee: '500.00', leadTimeDays: 2,
    }).returning({ id: townships.id });
    townshipIds.push(township.id);

    adminToken = await login(admin.email, 'admin-password');
    officerToken = await login(officer.email, 'officer-password');
    shopToken = await login(shopUser.email, 'shop-password');
    const [riderUser, secondRiderUser] = await database.db.insert(users).values([
      { name: '+Rider', email: `reports-rider-${run}@e2e.local`, passwordHash: await hashPassword('rider-password'), roleId: riderRole.id },
      { name: 'Other Reports Rider', email: `reports-other-rider-${run}@e2e.local`, passwordHash: await hashPassword('rider-password'), roleId: riderRole.id },
    ]).returning({ id: users.id, email: users.email });
    createdUserIds.push(riderUser.id, secondRiderUser.id);
    const createdRiders = await database.db.insert(riders).values([
      { userId: riderUser.id },
      { userId: secondRiderUser.id },
    ]).returning({ id: riders.id, userId: riders.userId });
    riderId = createdRiders[0]?.id ?? '';
    secondRiderId = createdRiders[1]?.id ?? '';
    riderToken = await login(`reports-rider-${run}@e2e.local`, 'rider-password');
    secondRiderToken = await login(`reports-other-rider-${run}@e2e.local`, 'rider-password');
  });

  afterAll(async () => {
    if (orderIds.length) {
      await database.db.delete(orderStatusHistory).where(inArray(orderStatusHistory.orderId, orderIds));
      await database.db.delete(orders).where(inArray(orders.id, orderIds));
    }
    if (riderId && secondRiderId) {
      await database.db.delete(riders).where(inArray(riders.id, [riderId, secondRiderId]));
    }
    if (createdUserIds.length) await database.db.delete(users).where(inArray(users.id, createdUserIds));
    if (shopId) await database.db.delete(shops).where(eq(shops.id, shopId));
    if (customerId) await database.db.delete(customers).where(eq(customers.id, customerId));
    if (townshipIds.length) await database.db.delete(townships).where(inArray(townships.id, townshipIds));
    if (officerRoleId) {
      await database.db.delete(role_permissions).where(eq(role_permissions.roleId, officerRoleId));
      if (previousOfficerGrants.length) {
        await database.db.insert(role_permissions).values(previousOfficerGrants.map((permissionId) => ({ roleId: officerRoleId, permissionId })));
      }
    }
    if (app) await app.close();
  });

  it('reports SQL-derived totals, exports securely, applies permissions, and scopes the rider dashboard', async () => {
    const timeZone = app.get(ConfigService).get<string>('APP_TIMEZONE') ?? 'Asia/Yangon';
    const today = getDateInTimeZone(new Date(), timeZone);
    const dates = `dateFrom=${today}&dateTo=${today}`;
    const dashboardBefore = await request(app.getHttpServer()).get(`/api/v1/reports/office-dashboard?${dates}`)
      .set('Authorization', `Bearer ${officerToken}`).expect(200);
    const firstDelivered = await createOrder({ riderId, packagePrice: '47000.00', deliveryFee: '3500.00' });
    await request(app.getHttpServer()).post(`/api/v1/riders/me/orders/${firstDelivered.id}/delivered`)
      .set('Authorization', `Bearer ${riderToken}`).expect(200);
    await request(app.getHttpServer()).post(`/api/v1/orders/${firstDelivered.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`).expect(200);

    const awaitingApproval = await createOrder({
      riderId, packagePrice: '18000.00', deliveryFee: '3500.00', isFeePaidToShop: true,
    });
    await request(app.getHttpServer()).post(`/api/v1/riders/me/orders/${awaitingApproval.id}/delivered`)
      .set('Authorization', `Bearer ${riderToken}`).expect(200);
    const pending = await createOrder({
      packagePrice: '95000.00', deliveryFee: '3500.00', estimatedDeliveryDate: shiftDate(today, -1),
    });
    const cancelled = await createOrder({ packagePrice: '1000.00', deliveryFee: '500.00' });
    await request(app.getHttpServer()).post(`/api/v1/orders/${cancelled.id}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`).send({ reason: 'Test cancelled order' }).expect(200);
    await createOrder({
      riderId: secondRiderId, packagePrice: '0.00', deliveryFee: '0.00',
      isPackagePaidToShop: true, isFeePaidToShop: true,
    });

    const shopFilter = `shopId=${shopId}`;
    const orderReport = await request(app.getHttpServer()).get(`/api/v1/reports/orders?${dates}&${shopFilter}&perPage=1`)
      .set('Authorization', `Bearer ${officerToken}`).expect(200);
    expect(orderReport.body.meta).toMatchObject({ page: 1, perPage: 1, total: 5, totalPages: 5 });
    expect(orderReport.body.data).toHaveLength(1);
    expect(orderReport.body.totals).toMatchObject({
      orderCount: 5,
      packagePrice: '160000.00',
      deliveryFee: '10500.00',
      codToCollect: '167000.00',
      netOwedToShop: '156500.00',
    });
    const customerSearch = await request(app.getHttpServer()).get('/api/v1/reports/orders')
      .query({ dateFrom: today, dateTo: today, shopId, search: '+1 555' })
      .set('Authorization', `Bearer ${officerToken}`).expect(200);
    expect(customerSearch.body.totals.orderCount).toBe(5);
    expect(customerSearch.body.data[0]).toMatchObject({
      customerName: '=HYPERLINK("https://bad")', customerPhone: '+1 555', deliveryAddress: '-2',
    });
    const customerNameSearch = await request(app.getHttpServer()).get('/api/v1/reports/orders')
      .query({ dateFrom: today, dateTo: today, shopId, search: '=HYPERLINK("https://bad")' })
      .set('Authorization', `Bearer ${officerToken}`).expect(200);
    expect(customerNameSearch.body.totals.orderCount).toBe(5);
    const singleOrderSearch = await request(app.getHttpServer()).get('/api/v1/reports/orders')
      .query({ dateFrom: today, dateTo: today, shopId, search: firstDelivered.trackingCode })
      .set('Authorization', `Bearer ${officerToken}`).expect(200);
    expect(singleOrderSearch.body.totals).toMatchObject({ orderCount: 1, packagePrice: '47000.00' });
    const wildcardSearch = await request(app.getHttpServer()).get('/api/v1/reports/orders')
      .query({ dateFrom: today, dateTo: today, shopId, search: '%' })
      .set('Authorization', `Bearer ${officerToken}`).expect(200);
    expect(wildcardSearch.body.totals.orderCount).toBe(0);

    const formulaExportRows: Record<string, string>[] = [];
    for (const format of ['csv', 'xlsx'] as const) {
      const exported = await request(app.getHttpServer()).get('/api/v1/reports/orders/export')
        .query({ dateFrom: today, dateTo: today, shopId, search: firstDelivered.trackingCode, format })
        .set('Authorization', `Bearer ${adminToken}`)
        .buffer(true)
        .parse((exportResponse, callback) => {
          const chunks: Buffer[] = [];
          exportResponse.on('data', (chunk: Buffer) => chunks.push(chunk));
          exportResponse.on('end', () => callback(null, Buffer.concat(chunks)));
        }).expect(200);
      if (!Buffer.isBuffer(exported.body)) throw new Error('Expected report export response to be a buffer');
      const workbook = format === 'csv'
        ? XLSX.read(exported.body.toString('utf8'), { type: 'string' })
        : XLSX.read(exported.body, { type: 'buffer' });
      const worksheetName = workbook.SheetNames[0];
      const worksheet = worksheetName ? workbook.Sheets[worksheetName] : undefined;
      if (!worksheet) throw new Error('Expected exported workbook to contain a worksheet');
      const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, raw: false });
      const headers = rows[0] as string[];
      const values = rows[1] as string[];
      formulaExportRows.push(Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
    }
    for (const row of formulaExportRows) {
      expect(row.customerName).toBe("'=HYPERLINK(\"https://bad\")");
      expect(row.customerPhone).toBe("'+1 555");
      expect(row.deliveryAddress).toBe("'-2");
      expect(row.shopName).toBe("'@x");
      expect(row.townshipName).toBe("'\tformula");
      expect(row.assigneeName).toBe("'+Rider");
    }
    await request(app.getHttpServer()).get(`/api/v1/reports/orders/export?${dates}&${shopFilter}&format=csv`)
      .set('Authorization', `Bearer ${adminToken}`).expect(200)
      .expect('content-type', /text\/csv/)
      .expect('content-disposition', new RegExp(`orders-${today}-to-${today}\\.csv`));
    await request(app.getHttpServer()).get(`/api/v1/reports/shop-statement/export?${dates}&shopId=${shopId}&format=xlsx`)
      .set('Authorization', `Bearer ${adminToken}`).expect(200)
      .expect('content-type', /spreadsheetml\.sheet/);
    const allRows = [] as Array<{ packagePrice: string; deliveryFee: string; codToCollect: string; netOwedToShop: string; partnerFee: string }>;
    for (let page = 1; page <= orderReport.body.meta.totalPages; page += 1) {
      const pageResponse = await request(app.getHttpServer())
        .get(`/api/v1/reports/orders?${dates}&${shopFilter}&perPage=1&page=${page}`)
        .set('Authorization', `Bearer ${officerToken}`).expect(200);
      allRows.push(...pageResponse.body.data as typeof allRows);
    }
    for (const key of ['packagePrice', 'deliveryFee', 'codToCollect', 'netOwedToShop', 'partnerFee'] as const) {
      expect(sumMoney(allRows.map((row) => row[key]))).toBe(orderReport.body.totals[key]);
    }

    const statement = await request(app.getHttpServer()).get(`/api/v1/reports/shop-statement?${dates}&shopId=${shopId}`)
      .set('Authorization', `Bearer ${officerToken}`).expect(200);
    expect(statement.body).toMatchObject({
      pendingCount: 1, assignedCount: 1, awaitingApprovalCount: 1, deliveredCount: 1, cancelledCount: 1,
      priceTotal: '160000.00', feeTotal: '10500.00', codCollected: '50500.00', codExpected: '116500.00',
      netOwedToShopDelivered: '47000.00', pendingNetOwedToShop: '109500.00',
    });

    const collection = await request(app.getHttpServer()).get(`/api/v1/reports/rider-collection?${dates}&riderId=${riderId}`)
      .set('Authorization', `Bearer ${officerToken}`).expect(200);
    expect(collection.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ riderId, deliveredOrderCount: 1, awaitingApprovalOrderCount: 1, expectedCodToHandBack: '50500.00', awaitingApprovalCod: '18000.00' }),
    ]));
    expect(collection.body.totals).toMatchObject({ expectedCodToHandBack: '50500.00', awaitingApprovalCod: '18000.00' });

    const payout = await request(app.getHttpServer()).get(`/api/v1/reports/rider-payout?${dates}&riderId=${riderId}`)
      .set('Authorization', `Bearer ${officerToken}`).expect(200);
    expect(payout.body.data).toHaveLength(1);
    expect(payout.body.data[0]).toMatchObject({
      deliveredOrderCount: 1, earnedAmount: '500.00',
      pendingApprovalOrderCount: 1, pendingApprovalAmount: '500.00',
    });
    expect(payout.body.totals).toMatchObject({
      deliveredOrderCount: 1, earnedAmount: '500.00',
      pendingApprovalOrderCount: 1, pendingApprovalAmount: '500.00',
    });

    const dashboard = await request(app.getHttpServer()).get(`/api/v1/reports/office-dashboard?${dates}`)
      .set('Authorization', `Bearer ${officerToken}`).expect(200);
    const kpi = (key: string): { count: number; amount: string } =>
      (dashboard.body.kpis as Array<{ key: string; count: number; amount: string }>).find((value) => value.key === key) ?? { count: -1, amount: '' };
    const kpiBefore = (key: string): { count: number; amount: string } =>
      (dashboardBefore.body.kpis as Array<{ key: string; count: number; amount: string }>).find((value) => value.key === key) ?? { count: -1, amount: '' };
    expect(kpi('todaysOrders').count - kpiBefore('todaysOrders').count).toBe(5);
    expect(kpi('awaitingApproval').count - kpiBefore('awaitingApproval').count).toBe(1);
    expect(subtractMoney(kpi('codToCollectToday').amount, kpiBefore('codToCollectToday').amount)).toBe('116500.00');
    expect(subtractMoney(kpi('feeIncomeToday').amount, kpiBefore('feeIncomeToday').amount)).toBe('3500.00');
    expect(kpi('delayedOrders').count - kpiBefore('delayedOrders').count).toBe(1);
    expect(dashboard.body.townshipSuccessRates).toContainEqual(expect.objectContaining({ successRate: '50.00' }));
    expect(dashboard.body.topShops).toContainEqual(expect.objectContaining({ shopId, orderCount: 5 }));
    const financialToday = (dashboard.body.feeIncomeVsPartnerCostVsCommission as Array<{ date: string; feeIncome: string; partnerCost: string; commissionEarned: string; margin: string }>).find((row) => row.date === today);
    const financialTodayBefore = (dashboardBefore.body.feeIncomeVsPartnerCostVsCommission as typeof dashboard.body.feeIncomeVsPartnerCostVsCommission).find((row: { date: string }) => row.date === today);
    expect(subtractMoney(financialToday?.feeIncome ?? '0.00', financialTodayBefore?.feeIncome ?? '0.00')).toBe('3500.00');
    expect(subtractMoney(financialToday?.partnerCost ?? '0.00', financialTodayBefore?.partnerCost ?? '0.00')).toBe('0.00');
    expect(subtractMoney(financialToday?.commissionEarned ?? '0.00', financialTodayBefore?.commissionEarned ?? '0.00')).toBe('500.00');
    expect(subtractMoney(financialToday?.margin ?? '0.00', financialTodayBefore?.margin ?? '0.00')).toBe('3000.00');

    const riderDashboard = await request(app.getHttpServer()).get('/api/v1/riders/me/dashboard')
      .set('Authorization', `Bearer ${riderToken}`).expect(200);
    expect(riderDashboard.body).toMatchObject({
      todayDeliveredCount: 1, weekDeliveredCount: 1, monthDeliveredCount: 1,
      commissionEarned: '500.00', commissionPending: '500.00', codToHandBack: '50500.00',
    });
    expect(riderDashboard.body.ordersPerDay).toEqual([{ date: today, orderCount: 1 }]);
    expect(riderDashboard.body).not.toHaveProperty('feeIncome');
    expect(riderDashboard.body).not.toHaveProperty('partnerCost');
    await request(app.getHttpServer()).get('/api/v1/reports/orders').set('Authorization', `Bearer ${riderToken}`)
      .expect(403);
    await request(app.getHttpServer()).get('/api/v1/reports/office-dashboard').set('Authorization', `Bearer ${riderToken}`)
      .expect(403);
    await request(app.getHttpServer()).get(`/api/v1/reports/orders/export?${dates}&format=csv`)
      .set('Authorization', `Bearer ${officerToken}`).expect(403);

    for (const path of [
      '/api/v1/reports/orders',
      `/api/v1/reports/orders/export?${dates}&format=csv`,
      `/api/v1/reports/shop-statement?${dates}&shopId=${shopId}`,
      `/api/v1/reports/shop-statement/export?${dates}&shopId=${shopId}&format=xlsx`,
      `/api/v1/reports/rider-collection?${dates}`,
      `/api/v1/reports/rider-collection/export?${dates}&format=csv`,
      `/api/v1/reports/rider-payout?${dates}`,
      `/api/v1/reports/rider-payout/export?${dates}&format=xlsx`,
      `/api/v1/reports/office-dashboard?${dates}`,
      '/api/v1/riders/me/dashboard',
    ]) {
      await request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${shopToken}`).expect(403);
    }
    await request(app.getHttpServer()).get('/api/v1/riders/me/dashboard')
      .set('Authorization', `Bearer ${secondRiderToken}`).expect(200);
    expect(pending.id).not.toBe(cancelled.id);
  });
});
