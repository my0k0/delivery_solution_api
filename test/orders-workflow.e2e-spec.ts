import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { eq, inArray, sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { setupApp, setupSwagger } from '../src/setup-app.js';
import { DatabaseService } from '../src/common/database/database.service.js';
import { hashPassword } from '../src/common/utils/password.util.js';
import { orderFieldAudit } from '../src/orders/order-field-audit.schema.js';
import { orderStatusHistory } from '../src/orders/order-status-history.schema.js';
import { orders } from '../src/orders/order.schema.js';
import { customers } from '../src/customers/customer.schema.js';
import { deliveryPartners } from '../src/delivery-partners/delivery-partner.schema.js';
import { permissions } from '../src/permissions/permissions.schema.js';
import { riders } from '../src/riders/rider.schema.js';
import { role_permissions } from '../src/roles/role-permissions.schema.js';
import { roles } from '../src/roles/roles.schema.js';
import { shops } from '../src/shops/shop.schema.js';
import { townships } from '../src/townships/township.schema.js';
import { users } from '../src/users/user.schema.js';

describe('Phase B office order workflow (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let ownerId = '';
  let riderUserId = '';
  let riderId = '';
  let otherRiderId = '';
  let editorUserId = '';
  let editorRoleId = '';
  let shopId = '';
  let customerId = '';
  let ownerToken = '';
  let riderToken = '';
  let editorToken = '';
  const orderIds: string[] = [];
  const townshipIds: string[] = [];
  const partnerIds: string[] = [];
  const run = Date.now();

  async function login(email: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return response.body.accessToken as string;
  }

  async function createOrder(input: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ shopId, customerId, ...input })
      .expect(201);
    orderIds.push(response.body.id as string);
    return response.body as Record<string, unknown>;
  }

  beforeAll(async () => {
    const moduleReference = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleReference.createNestApplication();
    setupApp(app);
    setupSwagger(app);
    await app.init();
    database = app.get(DatabaseService);

    const ownerRole = await database.db.query.roles.findFirst({ where: eq(roles.name, 'OWNER') });
    const riderRole = await database.db.query.roles.findFirst({ where: eq(roles.name, 'RIDER') });
    if (!ownerRole || !riderRole) throw new Error('Run db:seed before the e2e suite');
    const [owner] = await database.db.insert(users).values({
      name: 'Phase B E2E Owner', email: `phase-b-owner-${run}@e2e.local`,
      passwordHash: await hashPassword('owner-password'), roleId: ownerRole.id,
    }).returning({ id: users.id });
    ownerId = owner.id;
    const [riderUser] = await database.db.insert(users).values({
      name: 'Phase B E2E Rider', email: `phase-b-rider-${run}@e2e.local`,
      passwordHash: await hashPassword('rider-password'), roleId: riderRole.id,
    }).returning({ id: users.id });
    riderUserId = riderUser.id;
    const [rider] = await database.db.insert(riders).values({ userId: riderUserId }).returning({ id: riders.id });
    riderId = rider.id;
    const [otherRider] = await database.db.insert(riders).values({ userId: ownerId }).returning({ id: riders.id });
    otherRiderId = otherRider.id;

    const [editorRole] = await database.db.insert(roles).values({
      name: `PHASE_B_EDITOR_${run}`, description: 'Limited order editor', isSystem: false,
    }).returning({ id: roles.id });
    editorRoleId = editorRole.id;
    const updatePermission = await database.db.query.permissions.findFirst({ where: eq(permissions.name, 'orders.update') });
    if (!updatePermission) throw new Error('orders.update permission is missing');
    await database.db.insert(role_permissions).values({ roleId: editorRoleId, permissionId: updatePermission.id });
    const [editorUser] = await database.db.insert(users).values({
      name: 'Phase B E2E Editor', email: `phase-b-editor-${run}@e2e.local`,
      passwordHash: await hashPassword('editor-password'), roleId: editorRoleId,
    }).returning({ id: users.id });
    editorUserId = editorUser.id;

    const [shop] = await database.db.insert(shops).values({
      name: `Phase B Shop ${run}`,
      channelType: 'TELEGRAM',
      channelName: `PhaseBShop${run}`,
    }).returning({ id: shops.id });
    shopId = shop.id;
    const [customer] = await database.db.insert(customers).values({
      name: `Phase B Customer ${run}`, phone: '09123456789', address: 'Test street',
    }).returning({ id: customers.id });
    customerId = customer.id;

    ownerToken = await login(`phase-b-owner-${run}@e2e.local`, 'owner-password');
    riderToken = await login(`phase-b-rider-${run}@e2e.local`, 'rider-password');
    editorToken = await login(`phase-b-editor-${run}@e2e.local`, 'editor-password');
  });

  afterAll(async () => {
    if (orderIds.length > 0) {
      await database.db.delete(orderFieldAudit).where(inArray(orderFieldAudit.orderId, orderIds));
      await database.db.delete(orderStatusHistory).where(inArray(orderStatusHistory.orderId, orderIds));
      await database.db.delete(orders).where(inArray(orders.id, orderIds));
    }
    if (townshipIds.length > 0) await database.db.delete(townships).where(inArray(townships.id, townshipIds));
    if (partnerIds.length > 0) await database.db.delete(deliveryPartners).where(inArray(deliveryPartners.id, partnerIds));
    if (riderId || otherRiderId) {
      await database.db.delete(riders).where(inArray(riders.id, [riderId, otherRiderId].filter(Boolean)));
    }
    if (shopId) await database.db.delete(shops).where(eq(shops.id, shopId));
    if (customerId) await database.db.delete(customers).where(eq(customers.id, customerId));
    if (editorUserId || riderUserId || ownerId) {
      await database.db.delete(users).where(inArray(users.id, [editorUserId, riderUserId, ownerId].filter(Boolean)));
    }
    if (editorRoleId) {
      await database.db.delete(role_permissions).where(eq(role_permissions.roleId, editorRoleId));
      await database.db.delete(roles).where(eq(roles.id, editorRoleId));
    }
    if (app) await app.close();
  });

  it('creates orders with no township default and with a township default rider', async () => {
    const noDefaultResponse = await request(app.getHttpServer())
      .post('/api/v1/townships')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `No default ${run}`, defaultDeliveryFee: '2400.00', defaultCommissionFee: '400.00', leadTimeDays: 2 })
      .expect(201);
    const noDefaultTownshipId = noDefaultResponse.body.id as string;
    townshipIds.push(noDefaultTownshipId);
    const pendingOrder = await createOrder({ townshipId: noDefaultTownshipId });
    expect(pendingOrder.status).toBe('PENDING');
    expect(pendingOrder.deliveryFee).toBe('2400.00');
    expect(pendingOrder.estimatedDeliveryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const defaultResponse = await request(app.getHttpServer())
      .post('/api/v1/townships')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: `Default rider ${run}`, defaultDeliveryFee: '3100.00', defaultCommissionFee: '450.00', leadTimeDays: 1,
        defaultAssigneeType: 'RIDER', defaultRiderId: riderId,
      })
      .expect(201);
    const defaultTownshipId = defaultResponse.body.id as string;
    townshipIds.push(defaultTownshipId);
    const assignedOrder = await createOrder({ townshipId: defaultTownshipId });
    expect(assignedOrder.status).toBe('ASSIGNED');
    expect(assignedOrder.riderId).toBe(riderId);
    expect(assignedOrder.deliveryFee).toBe('3100.00');
  });

  it('submits a rider delivery for approval and approves it', async () => {
    const order = await createOrder({ riderId });
    const orderId = order.id as string;
    await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/mark-delivered`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(409);
    const submitted = await request(app.getHttpServer())
      .post(`/api/v1/riders/me/orders/${orderId}/delivered`)
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(200);
    expect(submitted.body.status).toBe('AWAITING_APPROVAL');
    expect(submitted.body.deliveredAt).toBeTruthy();
    expect(submitted.body).not.toHaveProperty('packagePrice');
    expect(submitted.body).not.toHaveProperty('partnerFee');

    const approved = await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/approve`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(approved.body.status).toBe('DELIVERED');
    expect(approved.body.deliveredAt).toBe(submitted.body.deliveredAt);
  });

  it('sends a submitted delivery back with separate shop-visible and internal notes', async () => {
    const order = await createOrder({ riderId });
    const orderId = order.id as string;
    await request(app.getHttpServer())
      .post(`/api/v1/riders/me/orders/${orderId}/delivered`)
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(200);
    const sentBack = await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/send-back`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'Please confirm the customer handoff', internalNote: 'Call customer before retry' })
      .expect(200);
    expect(sentBack.body.status).toBe('ASSIGNED');
    const history = await request(app.getHttpServer())
      .get(`/api/v1/orders/${orderId}/history`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(history.body.at(-1)).toMatchObject({
      reason: 'Please confirm the customer handoff',
      internalNote: 'Call customer before retry',
    });
  });

  it('cancels an order and records its required reason', async () => {
    const order = await createOrder();
    const cancelled = await request(app.getHttpServer())
      .post(`/api/v1/orders/${String(order.id)}/cancel`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'Customer cancelled before dispatch' })
      .expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(cancelled.body.cancelReason).toBe('Customer cancelled before dispatch');
  });

  it('marks partner orders delivered directly from ASSIGNED', async () => {
    const partnerResponse = await request(app.getHttpServer())
      .post('/api/v1/delivery-partners')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `E2E Partner ${run}`, isActive: true })
      .expect(201);
    const partnerId = partnerResponse.body.id as string;
    partnerIds.push(partnerId);
    const order = await createOrder({ partnerId });
    const delivered = await request(app.getHttpServer())
      .post(`/api/v1/orders/${String(order.id)}/mark-delivered`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(delivered.body.status).toBe('DELIVERED');
    expect(delivered.body.deliveredAt).toBeTruthy();
  });

  it('audits each edited field and enforces cost permissions', async () => {
    const order = await createOrder();
    const orderId = order.id as string;
    expect(order.packagePrice).toBe('0.00');
    await request(app.getHttpServer())
      .patch(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ packagePrice: '47000.00', deliveryAddress: 'Updated address', reason: 'Corrected voucher' })
      .expect(200);
    const editedOrder = await request(app.getHttpServer())
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(editedOrder.body.packagePrice).toBe('47000.00');
    const audit = await request(app.getHttpServer())
      .get(`/api/v1/orders/${orderId}/audit`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const [storedMoneyAudit] = await database.db.select({
      oldValue: sql<string>`${orderFieldAudit.oldValue}::text`,
      newValue: sql<string>`${orderFieldAudit.newValue}::text`,
    }).from(orderFieldAudit).where(eq(orderFieldAudit.orderId, orderId));
    expect(storedMoneyAudit?.oldValue).toBe('"0.00"');
    expect(storedMoneyAudit?.newValue).toBe('"47000.00"');
    expect(audit.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'packagePrice', oldValue: '0.00', newValue: '47000.00', reason: 'Corrected voucher' }),
      expect.objectContaining({ field: 'deliveryAddress', oldValue: null, newValue: 'Updated address', actorId: ownerId }),
    ]));

    await request(app.getHttpServer())
      .patch(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ packagePrice: '48000.00' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ deliveryAddress: 'Unauthorized edit' })
      .expect(403);

    const deliveredOrder = await createOrder({ riderId });
    const deliveredOrderId = deliveredOrder.id as string;
    await request(app.getHttpServer())
      .post(`/api/v1/riders/me/orders/${deliveredOrderId}/delivered`)
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/orders/${deliveredOrderId}/approve`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/orders/${deliveredOrderId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ packagePrice: '49000.00' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/orders/${deliveredOrderId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ packagePrice: '49000.00', reason: 'Corrected approved voucher' })
      .expect(200);
  });

  it('keeps the same rider assigned when township and riderId are re-sent together', async () => {
    const townshipResponse = await request(app.getHttpServer())
      .post('/api/v1/townships')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Edit township ${run}`, defaultDeliveryFee: '0', defaultCommissionFee: '0', leadTimeDays: 0 })
      .expect(201);
    const townshipId = townshipResponse.body.id as string;
    townshipIds.push(townshipId);
    const order = await createOrder({ riderId });
    const orderId = order.id as string;

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ townshipId, riderId })
      .expect(200);

    expect(updated.body).toMatchObject({ status: 'ASSIGNED', assigneeType: 'RIDER', riderId });
    const audit = await request(app.getHttpServer())
      .get(`/api/v1/orders/${orderId}/audit`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(audit.body.map((row: { field: string }) => row.field)).toEqual(['townshipId', 'estimatedDeliveryDate']);
    const history = await request(app.getHttpServer())
      .get(`/api/v1/orders/${orderId}/history`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(history.body).toHaveLength(1);
  });

  it('swaps riders by riderId alone and records one assignee history row and rider audit', async () => {
    const order = await createOrder({ riderId });
    const orderId = order.id as string;

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ riderId: otherRiderId })
      .expect(200);

    expect(updated.body).toMatchObject({ status: 'ASSIGNED', assigneeType: 'RIDER', riderId: otherRiderId, partnerId: null });
    const history = await request(app.getHttpServer())
      .get(`/api/v1/orders/${orderId}/history`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(history.body).toHaveLength(2);
    expect(history.body[1]).toMatchObject({
      previousAssignee: { type: 'RIDER', riderId, partnerId: null },
      newAssignee: { type: 'RIDER', riderId: otherRiderId, partnerId: null },
    });
    const audit = await request(app.getHttpServer())
      .get(`/api/v1/orders/${orderId}/audit`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(audit.body.map((row: { field: string }) => row.field)).toEqual(['riderId']);
  });

  it('swaps riders and partners in either direction while clearing the previous assignee', async () => {
    const partnerResponse = await request(app.getHttpServer())
      .post('/api/v1/delivery-partners')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Swap Partner ${run}`, isActive: true })
      .expect(201);
    const partnerId = partnerResponse.body.id as string;
    partnerIds.push(partnerId);

    const riderOrder = await createOrder({ riderId });
    const riderToPartner = await request(app.getHttpServer())
      .patch(`/api/v1/orders/${String(riderOrder.id)}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ partnerId })
      .expect(200);
    expect(riderToPartner.body).toMatchObject({ status: 'ASSIGNED', assigneeType: 'PARTNER', riderId: null, partnerId });

    const partnerOrder = await createOrder({ partnerId });
    const partnerToRider = await request(app.getHttpServer())
      .patch(`/api/v1/orders/${String(partnerOrder.id)}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ riderId: otherRiderId })
      .expect(200);
    expect(partnerToRider.body).toMatchObject({ status: 'ASSIGNED', assigneeType: 'RIDER', riderId: otherRiderId, partnerId: null });
  });

  it('returns an order to PENDING when riderId is explicitly cleared', async () => {
    const order = await createOrder({ riderId });

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/orders/${String(order.id)}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ riderId: null })
      .expect(200);

    expect(updated.body).toMatchObject({ status: 'PENDING', assigneeType: null, riderId: null, partnerId: null });
  });

  it('applyTownshipAssignee with no default makes the order PENDING, while an explicit rider wins', async () => {
    const townshipResponse = await request(app.getHttpServer())
      .post('/api/v1/townships')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `No assignee default ${run}`, defaultDeliveryFee: '0', defaultCommissionFee: '0', leadTimeDays: 0 })
      .expect(201);
    const townshipId = townshipResponse.body.id as string;
    townshipIds.push(townshipId);

    const clearedOrder = await createOrder({ riderId });
    const cleared = await request(app.getHttpServer())
      .patch(`/api/v1/orders/${String(clearedOrder.id)}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ townshipId, applyTownshipAssignee: true })
      .expect(200);
    expect(cleared.body).toMatchObject({ status: 'PENDING', assigneeType: null, riderId: null, partnerId: null });

    const explicitOrder = await createOrder({ riderId });
    const explicit = await request(app.getHttpServer())
      .patch(`/api/v1/orders/${String(explicitOrder.id)}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ townshipId, applyTownshipAssignee: true, riderId: otherRiderId })
      .expect(200);
    expect(explicit.body).toMatchObject({ status: 'ASSIGNED', assigneeType: 'RIDER', riderId: otherRiderId, partnerId: null });
  });

  it('does not touch the assignee or status when only notes change', async () => {
    const order = await createOrder({ riderId });

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/orders/${String(order.id)}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ notes: 'Updated without reassignment' })
      .expect(200);

    expect(updated.body).toMatchObject({ status: 'ASSIGNED', assigneeType: 'RIDER', riderId, notes: 'Updated without reassignment' });
    const history = await request(app.getHttpServer())
      .get(`/api/v1/orders/${String(order.id)}/history`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(history.body).toHaveLength(1);
    const audit = await request(app.getHttpServer())
      .get(`/api/v1/orders/${String(order.id)}/audit`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(audit.body.map((row: { field: string }) => row.field)).toEqual(['notes']);
  });
});
