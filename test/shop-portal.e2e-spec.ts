import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../src/app.module.js';
import { setupApp, setupSwagger } from '../src/setup-app.js';
import { DatabaseService } from '../src/common/database/database.service.js';
import { hashPassword } from '../src/common/utils/password.util.js';
import { getDateInTimeZone } from '../src/common/utils/timezone-date.util.js';
import { customers } from '../src/customers/customer.schema.js';
import { deliveryPartners } from '../src/delivery-partners/delivery-partner.schema.js';
import { orders, type OrderStatus } from '../src/orders/order.schema.js';
import { orderStatusHistory } from '../src/orders/order-status-history.schema.js';
import { permissions } from '../src/permissions/permissions.schema.js';
import { riders } from '../src/riders/rider.schema.js';
import { roles } from '../src/roles/roles.schema.js';
import { shops } from '../src/shops/shop.schema.js';
import { townships } from '../src/townships/township.schema.js';
import { users } from '../src/users/user.schema.js';

const FORBIDDEN_KEYS = [
  'riderId', 'riderName', 'partnerId', 'partnerName', 'assignee', 'assigneeType', 'assigneeName',
  'partnerTrackingNo', 'partnerFee', 'wayId', 'commission', 'margin', 'notes', 'internalNote',
  'internalNotes', 'actorId', 'actorUserId', 'changedBy', 'previousAssignee', 'newAssignee',
  'fieldAudit', 'field', 'oldValue', 'newValue',
] as const;

function valuesWithin(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(valuesWithin);
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => [key, ...valuesWithin(child)]);
  }
  return [];
}

function localTimeAsUtc(date: string, time: string, timeZone: string): Date {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(candidate));
    const values = new Map(parts.map((part) => [part.type, part.value]));
    const represented = Date.UTC(
      Number(values.get('year')), Number(values.get('month')) - 1, Number(values.get('day')),
      Number(values.get('hour')), Number(values.get('minute')), Number(values.get('second')),
    );
    candidate += target - represented;
  }
  return new Date(candidate);
}

function responseSchemaReferences(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(responseSchemaReferences);
  if (typeof value !== 'object' || value === null) return [];
  const object = value as Record<string, unknown>;
  const references = typeof object.$ref === 'string' ? [object.$ref] : [];
  return [...references, ...Object.values(object).flatMap(responseSchemaReferences)];
}

describe('Phase E shop portal (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let shopToken = '';
  let officerToken = '';
  let shopId = '';
  let otherShopId = '';
  let customerId = '';
  let townshipId = '';
  let riderId = '';
  let partnerId = '';
  let riderUserId = '';
  let ownerUserId = '';
  let otherShopOrderId = '';
  let sentBackOrderId = '';
  const orderIds: string[] = [];
  const userIds: string[] = [];
  const userEmails: string[] = [];
  const run = Date.now();
  const riderName = `Portal Leak Rider ${run}`;
  const riderEmail = `portal-rider-${run}@e2e.local`;
  const partnerName = `Portal Leak Partner ${run}`;
  const shopEmail = `portal-shop-${run}@e2e.local`;

  async function login(email: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password }).expect(200);
    const token = response.body.accessToken as unknown;
    if (typeof token !== 'string') throw new Error('Expected login response to contain an access token');
    return token;
  }

  beforeAll(async () => {
    const moduleReference = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleReference.createNestApplication();
    setupApp(app);
    setupSwagger(app);
    await app.init();
    database = app.get(DatabaseService);

    const roleRows = await Promise.all([
      database.db.query.roles.findFirst({ where: eq(roles.name, 'SHOP') }),
      database.db.query.roles.findFirst({ where: eq(roles.name, 'OWNER') }),
      database.db.query.roles.findFirst({ where: eq(roles.name, 'OFFICER') }),
      database.db.query.roles.findFirst({ where: eq(roles.name, 'RIDER') }),
    ]);
    const [shopRole, ownerRole, officerRole, riderRole] = roleRows;
    if (!shopRole || !ownerRole || !officerRole || !riderRole) throw new Error('Run pnpm db:seed before the e2e suite');
    const portalRead = await database.db.query.permissions.findFirst({ where: eq(permissions.name, 'shop-portal.read') });
    const portalExport = await database.db.query.permissions.findFirst({ where: eq(permissions.name, 'shop-reports.export') });
    if (!portalRead || !portalExport) throw new Error('Shop portal permissions are missing; re-run pnpm db:seed');

    const [shop] = await database.db.insert(shops).values({
      name: `Portal Shop ${run}`,
      channelType: 'TELEGRAM',
      channelName: `PortalShop${run}`,
    }).returning({ id: shops.id });
    const [otherShop] = await database.db.insert(shops).values({
      name: `Portal Other Shop ${run}`,
      channelType: 'TELEGRAM',
      channelName: `PortalOtherShop${run}`,
    }).returning({ id: shops.id });
    shopId = shop.id;
    otherShopId = otherShop.id;
    const adminRole = await database.db.query.roles.findFirst({ where: eq(roles.name, 'ADMIN') });
    if (!adminRole) throw new Error('ADMIN role is missing');
    const [shopUser, ownerUser, officerUser, noShopAdmin] = await database.db.insert(users).values([
      { name: `Portal Shop User ${run}`, email: shopEmail, passwordHash: await hashPassword('shop-password'), roleId: shopRole.id, shopId },
      { name: `Portal Owner ${run}`, email: `portal-owner-${run}@e2e.local`, passwordHash: await hashPassword('owner-password'), roleId: ownerRole.id },
      { name: `Portal Officer ${run}`, email: `portal-officer-${run}@e2e.local`, passwordHash: await hashPassword('officer-password'), roleId: officerRole.id },
      { name: `Portal No Shop Admin ${run}`, email: `portal-admin-no-shop-${run}@e2e.local`, passwordHash: await hashPassword('admin-password'), roleId: adminRole.id },
    ]).returning({ id: users.id, email: users.email });
    ownerUserId = ownerUser.id;
    userIds.push(shopUser.id, ownerUser.id, officerUser.id, noShopAdmin.id);
    userEmails.push(shopUser.email, ownerUser.email, officerUser.email, noShopAdmin.email);
    const [riderUser] = await database.db.insert(users).values({
      name: riderName, email: riderEmail, passwordHash: await hashPassword('rider-password'), roleId: riderRole.id,
    }).returning({ id: users.id });
    riderUserId = riderUser.id;
    userIds.push(riderUser.id);
    userEmails.push(riderEmail);
    const [rider] = await database.db.insert(riders).values({ userId: riderUserId }).returning({ id: riders.id });
    riderId = rider.id;
    const [partner] = await database.db.insert(deliveryPartners).values({ name: partnerName, isActive: true }).returning({ id: deliveryPartners.id });
    partnerId = partner.id;
    const [customer] = await database.db.insert(customers).values({ name: `Portal Customer ${run}`, phone: '09123456789', address: 'Portal delivery address' }).returning({ id: customers.id });
    customerId = customer.id;
    const [township] = await database.db.insert(townships).values({ name: `Portal Township ${run}`, defaultDeliveryFee: '3500.00', leadTimeDays: 1 }).returning({ id: townships.id });
    townshipId = township.id;

    shopToken = await login(shopEmail, 'shop-password');
    officerToken = await login(officerUser.email, 'officer-password');

    const timeZone = app.get(ConfigService).get<string>('APP_TIMEZONE') ?? 'Asia/Yangon';
    const today = getDateInTimeZone(new Date(), timeZone);
    const baseCreatedAt = localTimeAsUtc(today, '13:00', timeZone);
    const ordersToCreate: Array<{
      trackingCode: string;
      status: OrderStatus;
      assigneeType: 'RIDER' | 'PARTNER' | null;
      riderId: string | null;
      partnerId: string | null;
      packagePrice: string;
      deliveryFee: string;
      isPackagePaidToShop: boolean;
      isFeePaidToShop: boolean;
      estimatedDeliveryDate: Date;
      deliveredAt: Date | null;
      createdAt: Date;
      targetShopId: string;
    }> = [
      { trackingCode: `PORTAL-${run}-RIDER`, status: 'ASSIGNED', assigneeType: 'RIDER', riderId, partnerId: null, packagePrice: '47000.00', deliveryFee: '3500.00', isPackagePaidToShop: false, isFeePaidToShop: false, estimatedDeliveryDate: new Date(`${today}T00:00:00.000Z`), deliveredAt: null, createdAt: baseCreatedAt, targetShopId: shopId },
      { trackingCode: `PORTAL-${run}-PARTNER`, status: 'ASSIGNED', assigneeType: 'PARTNER', riderId: null, partnerId, packagePrice: '95000.00', deliveryFee: '3500.00', isPackagePaidToShop: false, isFeePaidToShop: false, estimatedDeliveryDate: new Date(`${today}T00:00:00.000Z`), deliveredAt: null, createdAt: baseCreatedAt, targetShopId: shopId },
      { trackingCode: `PORTAL-${run}-POSTPONED`, status: 'PENDING', assigneeType: null, riderId: null, partnerId: null, packagePrice: '18000.00', deliveryFee: '3500.00', isPackagePaidToShop: false, isFeePaidToShop: true, estimatedDeliveryDate: new Date(`${today}T00:00:00.000Z`), deliveredAt: null, createdAt: baseCreatedAt, targetShopId: shopId },
      { trackingCode: `PORTAL-${run}-SENDBACK`, status: 'ASSIGNED', assigneeType: 'RIDER', riderId, partnerId: null, packagePrice: '26000.00', deliveryFee: '3500.00', isPackagePaidToShop: false, isFeePaidToShop: false, estimatedDeliveryDate: new Date(`${today}T00:00:00.000Z`), deliveredAt: null, createdAt: baseCreatedAt, targetShopId: shopId },
      { trackingCode: `PORTAL-${run}-CANCELLED-REFUSED`, status: 'CANCELLED', assigneeType: null, riderId: null, partnerId: null, packagePrice: '36000.00', deliveryFee: '5000.00', isPackagePaidToShop: true, isFeePaidToShop: false, estimatedDeliveryDate: new Date(`${today}T00:00:00.000Z`), deliveredAt: null, createdAt: baseCreatedAt, targetShopId: shopId },
      { trackingCode: `PORTAL-${run}-CANCELLED`, status: 'CANCELLED', assigneeType: null, riderId: null, partnerId: null, packagePrice: '19000.00', deliveryFee: '5000.00', isPackagePaidToShop: false, isFeePaidToShop: false, estimatedDeliveryDate: new Date(`${today}T00:00:00.000Z`), deliveredAt: null, createdAt: baseCreatedAt, targetShopId: shopId },
      { trackingCode: `PORTAL-${run}-DELIVERED`, status: 'DELIVERED', assigneeType: 'RIDER', riderId, partnerId: null, packagePrice: '18000.00', deliveryFee: '3500.00', isPackagePaidToShop: false, isFeePaidToShop: true, estimatedDeliveryDate: new Date(`${today}T00:00:00.000Z`), deliveredAt: baseCreatedAt, createdAt: baseCreatedAt, targetShopId: shopId },
      { trackingCode: `PORTAL-${run}-OVERDUE`, status: 'PENDING', assigneeType: null, riderId: null, partnerId: null, packagePrice: '95000.00', deliveryFee: '3500.00', isPackagePaidToShop: false, isFeePaidToShop: false, estimatedDeliveryDate: new Date('2020-01-01T00:00:00.000Z'), deliveredAt: null, createdAt: baseCreatedAt, targetShopId: shopId },
      { trackingCode: `PORTAL-${run}-OTHER`, status: 'PENDING', assigneeType: null, riderId: null, partnerId: null, packagePrice: '1.00', deliveryFee: '1.00', isPackagePaidToShop: false, isFeePaidToShop: false, estimatedDeliveryDate: new Date(`${today}T00:00:00.000Z`), deliveredAt: null, createdAt: baseCreatedAt, targetShopId: otherShopId },
      { trackingCode: `PORTAL-${run}-BOUNDARY-START`, status: 'PENDING', assigneeType: null, riderId: null, partnerId: null, packagePrice: '0.00', deliveryFee: '0.00', isPackagePaidToShop: false, isFeePaidToShop: false, estimatedDeliveryDate: new Date(`${today}T00:00:00.000Z`), deliveredAt: null, createdAt: localTimeAsUtc(today, '09:00', timeZone), targetShopId: shopId },
      { trackingCode: `PORTAL-${run}-BOUNDARY-END`, status: 'PENDING', assigneeType: null, riderId: null, partnerId: null, packagePrice: '0.00', deliveryFee: '0.00', isPackagePaidToShop: false, isFeePaidToShop: false, estimatedDeliveryDate: new Date(`${today}T00:00:00.000Z`), deliveredAt: null, createdAt: localTimeAsUtc(today, '11:00', timeZone), targetShopId: shopId },
      { trackingCode: `PORTAL-${run}-BOUNDARY-OUT`, status: 'PENDING', assigneeType: null, riderId: null, partnerId: null, packagePrice: '0.00', deliveryFee: '0.00', isPackagePaidToShop: false, isFeePaidToShop: false, estimatedDeliveryDate: new Date(`${today}T00:00:00.000Z`), deliveredAt: null, createdAt: localTimeAsUtc(today, '11:01', timeZone), targetShopId: shopId },
    ];
    const insertedOrders = await database.db.insert(orders).values(ordersToCreate.map((order) => ({
      trackingCode: order.trackingCode,
      shopId: order.targetShopId,
      customerId,
      townshipId,
      assigneeType: order.assigneeType,
      riderId: order.riderId,
      partnerId: order.partnerId,
      packagePrice: order.packagePrice,
      deliveryFee: order.deliveryFee,
      isPackagePaidToShop: order.isPackagePaidToShop,
      isFeePaidToShop: order.isFeePaidToShop,
      estimatedDeliveryDate: order.estimatedDeliveryDate,
      deliveredAt: order.deliveredAt,
      createdAt: order.createdAt,
      status: order.status,
      deliveryAddress: 'Shop-safe delivery address',
      notes: 'Private office note must not leave the office.',
      partnerFee: order.assigneeType === 'PARTNER' ? '9999.00' : '0.00',
    }))).returning({ id: orders.id, status: orders.status, trackingCode: orders.trackingCode });
    orderIds.push(...insertedOrders.map((order) => order.id));
    otherShopOrderId = insertedOrders.find((order) => order.trackingCode.endsWith('-OTHER'))?.id ?? '';
    sentBackOrderId = insertedOrders.find((order) => order.trackingCode.endsWith('-SENDBACK'))?.id ?? '';

    const historyRows: (typeof orderStatusHistory.$inferInsert)[] = insertedOrders.flatMap((order): (typeof orderStatusHistory.$inferInsert)[] => {
      const ownerActor = ownerUserId;
      if (order.trackingCode.endsWith('-POSTPONED')) return [
        { orderId: order.id, fromStatus: null, toStatus: 'PENDING' as const, changedBy: ownerActor, note: 'Initial record', reason: null, internalNote: null },
        { orderId: order.id, fromStatus: 'ASSIGNED' as const, toStatus: 'PENDING' as const, changedBy: ownerActor, note: 'Delivery postponed', reason: 'Customer requested tomorrow', internalNote: 'Private postpone note' },
      ];
      if (order.trackingCode.endsWith('-SENDBACK')) return [
        { orderId: order.id, fromStatus: null, toStatus: 'ASSIGNED' as const, changedBy: ownerActor, note: 'Initial record', reason: null, internalNote: null },
        { orderId: order.id, fromStatus: 'ASSIGNED' as const, toStatus: 'AWAITING_APPROVAL' as const, changedBy: ownerActor, note: 'Submitted', reason: null, internalNote: null },
        { orderId: order.id, fromStatus: 'AWAITING_APPROVAL' as const, toStatus: 'ASSIGNED' as const, changedBy: ownerActor, note: 'Sent back', reason: 'Please confirm handoff', internalNote: `Leak internal ${run}` },
      ];
      if (order.trackingCode.endsWith('-CANCELLED-REFUSED')) return [
        { orderId: order.id, fromStatus: null, toStatus: 'PENDING' as const, changedBy: ownerActor, note: 'Initial record', reason: null, internalNote: null },
        { orderId: order.id, fromStatus: 'PENDING' as const, toStatus: 'CANCELLED' as const, changedBy: ownerActor, note: 'Cancelled', reason: 'Customer refused package', internalNote: null },
      ];
      return [{ orderId: order.id, fromStatus: null, toStatus: order.status, changedBy: ownerActor, note: 'Initial record', reason: null, internalNote: null }];
    });
    await database.db.insert(orderStatusHistory).values(historyRows);
  });

  afterAll(async () => {
    if (orderIds.length) {
      await database.db.delete(orderStatusHistory).where(inArray(orderStatusHistory.orderId, orderIds));
      await database.db.delete(orders).where(inArray(orders.id, orderIds));
    }
    if (riderId) await database.db.delete(riders).where(eq(riders.id, riderId));
    if (partnerId) await database.db.delete(deliveryPartners).where(eq(deliveryPartners.id, partnerId));
    if (userIds.length) await database.db.delete(users).where(inArray(users.id, userIds));
    if (shopId || otherShopId) await database.db.delete(shops).where(inArray(shops.id, [shopId, otherShopId].filter(Boolean)));
    if (customerId) await database.db.delete(customers).where(eq(customers.id, customerId));
    if (townshipId) await database.db.delete(townships).where(eq(townships.id, townshipId));
    if (app) await app.close();
  });

  it('returns shop-scoped portal data, validates unknown scope, and denies cross-role access', async () => {
    const config = app.get(ConfigService);
    const timeZone = config.get<string>('APP_TIMEZONE') ?? 'Asia/Yangon';
    const today = getDateInTimeZone(new Date(), timeZone);
    const dates = { dateFrom: today, dateTo: today };
    const forbiddenValues = [riderName, riderEmail, partnerName, riderId, partnerId, ...userIds, ...userEmails, otherShopOrderId, `Leak internal ${run}`];
    const assertNoLeaks = (body: unknown): void => {
      const values = valuesWithin(body);
      for (const key of FORBIDDEN_KEYS) expect(values).not.toContain(key);
      const serialized = values.join('\n');
      for (const value of forbiddenValues) expect(serialized).not.toContain(value);
    };

    const list = await request(app.getHttpServer()).get('/api/v1/shop/orders').query(dates)
      .set('Authorization', `Bearer ${shopToken}`).expect(200);
    assertNoLeaks(list.body);
    expect(list.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ trackingCode: expect.stringContaining('RIDER'), codToCollect: '50500.00', netOwedToShop: '47000.00' }),
      expect.objectContaining({ trackingCode: expect.stringContaining('DELIVERED'), codToCollect: '18000.00', netOwedToShop: '14500.00' }),
      expect.objectContaining({ trackingCode: expect.stringContaining('PARTNER'), codToCollect: '98500.00', netOwedToShop: '95000.00' }),
      expect.objectContaining({ trackingCode: expect.stringContaining('OVERDUE'), needsAttention: true }),
    ]));
    expect(list.body.data.every((row: { id: string }) => row.id !== otherShopOrderId)).toBe(true);
    expect(list.body.totals).toMatchObject({
      packagePrice: '299000.00',
      deliveryFee: '21000.00',
      total: '320000.00',
    });

    const detail = await request(app.getHttpServer()).get(`/api/v1/shop/orders/${sentBackOrderId}`)
      .set('Authorization', `Bearer ${shopToken}`).expect(200);
    assertNoLeaks(detail.body);
    expect(detail.body.history).toEqual(expect.arrayContaining([
      expect.objectContaining({ displayStatus: 'OUT_FOR_DELIVERY', reason: 'Please confirm handoff' }),
    ]));

    const dashboard = await request(app.getHttpServer()).get('/api/v1/shop/dashboard').query(dates)
      .set('Authorization', `Bearer ${shopToken}`).expect(200);
    assertNoLeaks(dashboard.body);
    expect(dashboard.body.money).toMatchObject({ codCollected: '18000.00', netSettlementDelivered: '14500.00' });

    const statement = await request(app.getHttpServer()).get('/api/v1/shop/statement').query(dates)
      .set('Authorization', `Bearer ${shopToken}`).expect(200);
    assertNoLeaks(statement.body);
    expect(statement.body).toMatchObject({
      receivedCount: 5, outForDeliveryCount: 3, deliveredCount: 1, cancelledCount: 2,
      codCollected: '18000.00', codExpected: '295000.00',
      netOwedToShopDelivered: '14500.00', pendingNetOwedToShop: '277500.00', netOwedToShopTotal: '292000.00',
    });

    const exportCells: string[] = [];
    for (const path of ['/api/v1/shop/orders/export', '/api/v1/shop/statement/export']) {
      for (const format of ['csv', 'xlsx'] as const) {
        const downloaded = await request(app.getHttpServer()).get(path).query({ ...dates, format })
          .set('Authorization', `Bearer ${shopToken}`).buffer(true)
          .parse((response, callback) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () => callback(null, Buffer.concat(chunks)));
          }).expect(200);
        if (!Buffer.isBuffer(downloaded.body)) throw new Error('Expected export response to be a buffer');
        if (format === 'csv') {
          const text = downloaded.body.toString('utf8');
          expect(text.charCodeAt(0)).toBe(0xfeff);
          exportCells.push(text);
        } else {
          const workbook = XLSX.read(downloaded.body, { type: 'buffer' });
          const sheetName = workbook.SheetNames[0];
          const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
          if (!sheet) throw new Error('Expected XLSX export to contain a worksheet');
          exportCells.push(XLSX.utils.sheet_to_csv(sheet));
        }
      }
    }
    for (const content of exportCells) {
      for (const key of FORBIDDEN_KEYS) expect(content).not.toContain(key);
      for (const value of forbiddenValues) expect(content).not.toContain(value);
    }

    const boundary = await request(app.getHttpServer()).get('/api/v1/shop/orders').query({
      ...dates, timeFrom: '09:00', timeTo: '11:00', search: `PORTAL-${run}-BOUNDARY`,
    }).set('Authorization', `Bearer ${shopToken}`).expect(200);
    expect(boundary.body.data.map((row: { trackingCode: string }) => row.trackingCode).sort()).toEqual([
      `PORTAL-${run}-BOUNDARY-END`, `PORTAL-${run}-BOUNDARY-START`,
    ]);

    await request(app.getHttpServer()).get('/api/v1/shop/orders').query({ ...dates, shopId: otherShopId })
      .set('Authorization', `Bearer ${shopToken}`).expect(400);
    await request(app.getHttpServer()).get(`/api/v1/shop/orders/${otherShopOrderId}`)
      .set('Authorization', `Bearer ${shopToken}`).expect(404);

    for (const path of [
      '/api/v1/orders', `/api/v1/reports/orders?dateFrom=${today}&dateTo=${today}`,
      '/api/v1/ways', '/api/v1/townships', '/api/v1/users',
    ]) await request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${shopToken}`).expect(403);

    const noShopAdmin = await login(`portal-admin-no-shop-${run}@e2e.local`, 'admin-password');
    const protectedShopPaths = [
      '/api/v1/shop/orders',
      `/api/v1/shop/orders/${sentBackOrderId}`,
      '/api/v1/shop/dashboard',
      '/api/v1/shop/statement',
      `/api/v1/shop/orders/export?dateFrom=${today}&dateTo=${today}&format=csv`,
      `/api/v1/shop/statement/export?dateFrom=${today}&dateTo=${today}&format=xlsx`,
    ];
    for (const path of protectedShopPaths) {
      await request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${noShopAdmin}`).expect(403);
      await request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${officerToken}`).expect(403);
    }

    const docs = await request(app.getHttpServer()).get('/api/v1/docs-json').expect(200);
    const paths = docs.body.paths as Record<string, Record<string, unknown>>;
    const components = docs.body.components.schemas as Record<string, unknown>;
    const referenced = new Set<string>();
    for (const [path, operations] of Object.entries(paths)) {
      if (!path.startsWith('/api/v1/shop/')) continue;
      for (const operation of Object.values(operations)) {
        const references = responseSchemaReferences(operation);
        for (const reference of references) {
          const schemaName = reference.split('/').at(-1);
          if (schemaName) referenced.add(schemaName);
        }
      }
    }
    const openApiSchemaValues = [...referenced].flatMap((name) => valuesWithin(components[name]));
    for (const key of FORBIDDEN_KEYS) expect(openApiSchemaValues).not.toContain(key);
    expect(Object.keys(paths).filter((path) => path.startsWith('/api/v1/shop/')).length).toBeGreaterThanOrEqual(6);
  });
});
