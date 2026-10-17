import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { setupApp, setupSwagger } from '../src/setup-app.js';
import { DatabaseService } from '../src/common/database/database.service.js';
import { hashPassword } from '../src/common/utils/password.util.js';
import { orderStatusHistory } from '../src/orders/order-status-history.schema.js';
import { orders } from '../src/orders/order.schema.js';
import { customers } from '../src/customers/customer.schema.js';
import { riders } from '../src/riders/rider.schema.js';
import { roles } from '../src/roles/roles.schema.js';
import { shops } from '../src/shops/shop.schema.js';
import { users } from '../src/users/user.schema.js';
import { ways } from '../src/ways/way.schema.js';

describe('Phase C ways and commission (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let adminToken = '';
  let officerToken = '';
  let riderToken = '';
  let riderId = '';
  let shopId = '';
  let customerId = '';
  const createdUserIds: string[] = [];
  const orderIds: string[] = [];
  const wayIds: string[] = [];
  const run = Date.now();

  async function login(email: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return response.body.accessToken as string;
  }

  beforeAll(async () => {
    const moduleReference = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleReference.createNestApplication();
    setupApp(app);
    setupSwagger(app);
    await app.init();
    database = app.get(DatabaseService);

    const [adminRole, officerRole, riderRole] = await Promise.all([
      database.db.query.roles.findFirst({ where: eq(roles.name, 'ADMIN') }),
      database.db.query.roles.findFirst({ where: eq(roles.name, 'OFFICER') }),
      database.db.query.roles.findFirst({ where: eq(roles.name, 'RIDER') }),
    ]);
    if (!adminRole || !officerRole || !riderRole) throw new Error('Run db:seed before the e2e suite');

    const [admin, officer, riderUser] = await database.db.insert(users).values([
      {
        name: 'Phase C E2E Admin', email: `phase-c-admin-${run}@e2e.local`,
        passwordHash: await hashPassword('admin-password'), roleId: adminRole.id,
      },
      {
        name: 'Phase C E2E Officer', email: `phase-c-officer-${run}@e2e.local`,
        passwordHash: await hashPassword('officer-password'), roleId: officerRole.id,
      },
      {
        name: 'Phase C E2E Rider', email: `phase-c-rider-${run}@e2e.local`,
        passwordHash: await hashPassword('rider-password'), roleId: riderRole.id,
      },
    ]).returning({ id: users.id, email: users.email });
    createdUserIds.push(admin.id, officer.id, riderUser.id);
    const [rider] = await database.db.insert(riders).values({ userId: riderUser.id }).returning({ id: riders.id });
    riderId = rider.id;
    const [shop] = await database.db.insert(shops).values({
      name: `Phase C Shop ${run}`,
      channelType: 'TELEGRAM',
      channelName: `PhaseCShop${run}`,
    }).returning({ id: shops.id });
    shopId = shop.id;
    const [customer] = await database.db.insert(customers).values({
      name: `Phase C Customer ${run}`, phone: '09123456789', address: 'Ways e2e street',
    }).returning({ id: customers.id });
    customerId = customer.id;

    adminToken = await login(admin.email, 'admin-password');
    officerToken = await login(officer.email, 'officer-password');
    riderToken = await login(riderUser.email, 'rider-password');
  });

  afterAll(async () => {
    if (orderIds.length) {
      await database.db.delete(orderStatusHistory).where(inArray(orderStatusHistory.orderId, orderIds));
      await database.db.delete(orders).where(inArray(orders.id, orderIds));
    }
    if (riderId) await database.db.delete(ways).where(eq(ways.riderId, riderId));
    if (riderId) await database.db.delete(riders).where(eq(riders.id, riderId));
    if (shopId) await database.db.delete(shops).where(eq(shops.id, shopId));
    if (customerId) await database.db.delete(customers).where(eq(customers.id, customerId));
    if (createdUserIds.length) await database.db.delete(users).where(inArray(users.id, createdUserIds));
    if (app) await app.close();
  });

  it('auto-joins assigned orders, starts a new way, moves an order and enforces pay-anyway permissions', async () => {
    const firstOrderResponse = await request(app.getHttpServer())
      .post('/api/v1/orders').set('Authorization', `Bearer ${adminToken}`)
      .send({ shopId, customerId, riderId }).expect(201);
    const firstOrderId = firstOrderResponse.body.id as string;
    const initialWayId = firstOrderResponse.body.wayId as string;
    orderIds.push(firstOrderId);

    const secondOrderResponse = await request(app.getHttpServer())
      .post('/api/v1/orders').set('Authorization', `Bearer ${adminToken}`)
      .send({ shopId, customerId, riderId }).expect(201);
    const secondOrderId = secondOrderResponse.body.id as string;
    orderIds.push(secondOrderId);
    expect(secondOrderResponse.body.wayId).toBe(initialWayId);

    const newWayResponse = await request(app.getHttpServer())
      .post('/api/v1/ways').set('Authorization', `Bearer ${adminToken}`)
      .send({ riderId }).expect(201);
    const newWayId = newWayResponse.body.id as string;
    wayIds.push(initialWayId, newWayId);
    expect(newWayResponse.body).toMatchObject({ state: 'EMPTY', isOpen: true, sequence: 2 });

    const moved = await request(app.getHttpServer())
      .post(`/api/v1/ways/${initialWayId}/move-orders`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ orderIds: [firstOrderId], targetWayId: newWayId }).expect(200);
    expect(moved.body.orders).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: firstOrderId, wayId: newWayId }),
    ]));
    const movedHistory = await request(app.getHttpServer())
      .get(`/api/v1/orders/${firstOrderId}/history`)
      .set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(movedHistory.body.at(-1).note).toContain('moved from way');

    const riderBoard = await request(app.getHttpServer())
      .get('/api/v1/riders/me/orders')
      .set('Authorization', `Bearer ${riderToken}`).expect(200);
    const boardOrder = riderBoard.body.find((order: { id: string }) => order.id === firstOrderId);
    expect(boardOrder).toMatchObject({ wayId: newWayId });
    expect(boardOrder.wayLabel).toMatch(/^\d{4}-\d{2}-\d{2} · 2$/);
    expect(boardOrder).not.toHaveProperty('commissionRate');
    expect(boardOrder).not.toHaveProperty('partnerFee');

    await request(app.getHttpServer())
      .post(`/api/v1/riders/me/orders/${secondOrderId}/delivered`)
      .set('Authorization', `Bearer ${riderToken}`).expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/orders/${secondOrderId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`).expect(200);
    const earnedWay = await request(app.getHttpServer())
      .get(`/api/v1/ways/${initialWayId}`)
      .set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(earnedWay.body).toMatchObject({ state: 'EARNED', commissionAmount: '500.00', pendingAmount: '0.00' });

    await request(app.getHttpServer())
      .post(`/api/v1/ways/${newWayId}/pay-anyway`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ reason: 'Approved by officer' }).expect(403);
    const paidWay = await request(app.getHttpServer())
      .post(`/api/v1/ways/${newWayId}/pay-anyway`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Weather prevented delivery' }).expect(200);
    expect(paidWay.body).toMatchObject({
      state: 'PAID_ANYWAY',
      commissionAmount: '500.00',
      isPaidWithoutDelivery: true,
      payAnywayReason: 'Weather prevented delivery',
    });
    await request(app.getHttpServer())
      .post(`/api/v1/ways/${newWayId}/pay-anyway`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Try again' }).expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/ways/${initialWayId}/pay-anyway`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Already earned' }).expect(409);
  });

  it('caps the commission rate at what numeric(12,2) can store', async () => {
    const commissionUrl = '/api/v1/ways/settings/commission-per-way';
    const put = (value: string) =>
      request(app.getHttpServer())
        .put(commissionUrl)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value });

    const original = await request(app.getHttpServer())
      .get(commissionUrl)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // 11+ integer digits passed the old @MaxLength(13), then overflowed
    // numeric(12,2) in Postgres and surfaced as a 500 instead of a 400.
    await put('12345678901').expect(400);
    await put('1234567890123').expect(400);
    await put('1.234').expect(400);
    await put('1234567890.123').expect(400);

    const integerOnly = await put('9999999999').expect(200);
    expect(integerOnly.body).toEqual({
      key: 'commissionPerWay',
      value: '9999999999.00',
    });
    const maxValue = await put('9999999999.99').expect(200);
    expect(maxValue.body).toEqual({
      key: 'commissionPerWay',
      value: '9999999999.99',
    });

    await put(original.body.value as string).expect(200);
  });
});
