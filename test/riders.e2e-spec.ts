import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { setupApp, setupSwagger } from '../src/setup-app.js';
import { DatabaseService } from '../src/common/database/database.service.js';
import { users } from '../src/users/user.schema.js';
import { roles } from '../src/roles/roles.schema.js';
import { riders } from '../src/riders/rider.schema.js';
import { hashPassword } from '../src/common/utils/password.util.js';

describe('Riders (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let ownerId: string;
  let ownerToken: string;
  const createdRiderIds: string[] = [];
  const createdUserIds: string[] = [];
  const run = Date.now();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    setupSwagger(app);
    await app.init();
    database = app.get(DatabaseService);

    const role = await database.db.query.roles.findFirst({
      where: eq(roles.name, 'OWNER'),
      columns: { id: true },
    });
    if (!role) throw new Error('OWNER role missing - run db:seed');
    const [user] = await database.db
      .insert(users)
      .values({
        name: 'Riders E2E Owner',
        email: `riders-owner-${run}@e2e.local`,
        passwordHash: await hashPassword('Password1234'),
        roleId: role.id,
        status: 'ACTIVE',
      })
      .returning({ id: users.id });
    ownerId = user.id;

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: `riders-owner-${run}@e2e.local`,
        password: 'Password1234',
      })
      .expect(200);
    ownerToken = login.body.accessToken as string;
  });

  afterAll(async () => {
    for (const id of createdRiderIds) {
      await database.db.delete(riders).where(eq(riders.id, id));
    }
    for (const id of createdUserIds) {
      await database.db.delete(users).where(eq(users.id, id));
    }
    await database.db.delete(users).where(eq(users.id, ownerId));
    await app.close();
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/api/v1/riders').expect(401);
  });

  it('creates a rider account and manages the rider profile', async () => {
    const email = `rider-${run}@e2e.local`;
    const created = await request(app.getHttpServer())
      .post('/api/v1/riders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: `Rider ${run}`,
        email,
        phone: '09123456789',
        password: 'password1',
        vehicleType: 'MOTORBIKE',
        vehiclePlate: `MDY-${run}`,
        licenseNo: `DL-${run}`,
        nrcNumber: `NRC-${run}`,
        emergencyContactPhone: '09111111111',
        notes: 'Prefers north townships',
      })
      .expect(201);
    const riderId = created.body.id as string;
    const userId = created.body.userId as string;
    createdRiderIds.push(riderId);
    createdUserIds.push(userId);

    expect(created.body.vehicleType).toBe('MOTORBIKE');
    expect(created.body.vehiclePlate).toBe(`MDY-${run}`);
    expect(created.body.licenseNo).toBe(`DL-${run}`);
    expect(created.body.nrcNumber).toBe(`NRC-${run}`);
    expect(created.body.emergencyContactPhone).toBe('09111111111');
    expect(created.body.notes).toBe('Prefers north townships');
    expect(created.body).not.toHaveProperty('townshipIds');

    expect(created.body.role).toBeUndefined();
    expect(created.body.email).toBe(email);
    expect(created.body).not.toHaveProperty('passwordHash');

    const assignable = await request(app.getHttpServer())
      .get('/api/v1/riders/assignable')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(assignable.body).toContainEqual(
      expect.objectContaining({ id: riderId, name: `Rider ${run}` }),
    );

    const riderLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'password1' })
      .expect(200);
    expect(riderLogin.body.user.role).toBe('RIDER');

    const listed = await request(app.getHttpServer())
      .get(`/api/v1/riders?search=${run}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(listed.body.data.map((rider: { id: string }) => rider.id)).toContain(
      riderId,
    );

    await request(app.getHttpServer())
      .get(`/api/v1/riders/${riderId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/riders/${riderId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Updated Rider ${run}` })
      .expect(200);
    expect(updated.body.name).toBe(`Updated Rider ${run}`);

    await request(app.getHttpServer())
      .patch(`/api/v1/riders/${riderId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ townshipIds: [] })
      .expect(400);

    await request(app.getHttpServer())
      .delete(`/api/v1/riders/${riderId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);
    createdRiderIds.splice(createdRiderIds.indexOf(riderId), 1);
    createdUserIds.splice(createdUserIds.indexOf(userId), 1);

    await request(app.getHttpServer())
      .get(`/api/v1/riders/${riderId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'password1' })
      .expect(401);
  });

  it('validates the required password', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/riders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Invalid Rider',
        email: `invalid-rider-${run}@e2e.local`,
        password: 'short',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/riders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Bad Vehicle',
        email: `bad-vehicle-${run}@e2e.local`,
        password: 'password1',
        vehicleType: 'HELICOPTER',
      })
      .expect(400);
  });

  it('defaults vehicleType to BIKE and updates licensing fields', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/riders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: `Default Rider ${run}`,
        email: `default-rider-${run}@e2e.local`,
        password: 'password1',
      })
      .expect(201);
    const riderId = created.body.id as string;
    createdRiderIds.push(riderId);
    createdUserIds.push(created.body.userId as string);

    expect(created.body.vehicleType).toBe('BIKE');
    expect(created.body.vehiclePlate).toBeNull();
    expect(created.body.licenseNo).toBeNull();

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/riders/${riderId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ vehicleType: 'CAR', vehiclePlate: `CAR-${run}`, licenseNo: null })
      .expect(200);
    expect(updated.body.vehicleType).toBe('CAR');
    expect(updated.body.vehiclePlate).toBe(`CAR-${run}`);
    expect(updated.body.licenseNo).toBeNull();
  });

  it('rejects a commission override that numeric(12,2) cannot store', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/riders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: `Override Rider ${run}`,
        email: `override-rider-${run}@e2e.local`,
        password: 'password1',
      })
      .expect(201);
    const riderId = created.body.id as string;
    createdRiderIds.push(riderId);
    createdUserIds.push(created.body.userId as string);

    // 11 integer digits overflow numeric(12,2); the DTO used to allow 13 chars.
    await request(app.getHttpServer())
      .patch(`/api/v1/riders/${riderId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ commissionPerWayOverride: '12345678901' })
      .expect(400);

    const atLimit = await request(app.getHttpServer())
      .patch(`/api/v1/riders/${riderId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ commissionPerWayOverride: '9999999999.99' })
      .expect(200);
    expect(atLimit.body.commissionPerWayOverride).toBe('9999999999.99');
  });
});
