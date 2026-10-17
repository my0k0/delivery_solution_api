import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../common/database/database.service.js';
import { isUniqueViolation } from '../common/database/is-unique-violation.js';
import { escapeLikeWildcards, normalizeEmail } from '../common/utils/normalize.util.js';
import { hashPassword } from '../common/utils/password.util.js';
import { roles } from '../roles/roles.schema.js';
import { users } from '../users/user.schema.js';
import { CreateRiderDto } from './dto/create-rider.dto.js';
import { ListRidersQueryDto } from './dto/list-riders-query.dto.js';
import { RiderListResponseDto } from './dto/rider-list-response.dto.js';
import { RiderResponseDto } from './dto/rider-response.dto.js';
import { UpdateRiderDto } from './dto/update-rider.dto.js';
import { AssignableRiderResponseDto } from './dto/assignable-rider-response.dto.js';
import { riders } from './rider.schema.js';
import type { RiderVehicleType } from './rider.schema.js';

type RiderJoinedRow = {
  riderId: string;
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  vehicleType: RiderVehicleType;
  vehiclePlate: string | null;
  licenseNo: string | null;
  nrcNumber: string | null;
  emergencyContactPhone: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRiderResponse(row: RiderJoinedRow): RiderResponseDto {
  return {
    id: row.riderId,
    userId: row.userId,
    name: row.name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    vehicleType: row.vehicleType,
    vehiclePlate: row.vehiclePlate,
    licenseNo: row.licenseNo,
    nrcNumber: row.nrcNumber,
    emergencyContactPhone: row.emergencyContactPhone,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class RidersService {
  constructor(
    private readonly database: DatabaseService,
  ) {}

  async list(query: ListRidersQueryDto): Promise<RiderListResponseDto> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const conditions = [];

    if (query.search?.trim()) {
      const search = `%${escapeLikeWildcards(query.search.trim())}%`;
      conditions.push(
        or(
          ilike(users.name, search),
          ilike(users.email, search),
          ilike(users.phone, search),
        ),
      );
    }
    if (query.status) conditions.push(eq(users.status, query.status));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      this.database.db
        .select({
          riderId: riders.id,
          userId: users.id,
          name: users.name,
          email: users.email,
          phone: users.phone,
          status: users.status,
          vehicleType: riders.vehicleType,
          vehiclePlate: riders.vehiclePlate,
          licenseNo: riders.licenseNo,
          nrcNumber: riders.nrcNumber,
          emergencyContactPhone: riders.emergencyContactPhone,
          notes: riders.notes,
          createdAt: riders.createdAt,
          updatedAt: riders.updatedAt,
        })
        .from(riders)
        .innerJoin(users, eq(riders.userId, users.id))
        .innerJoin(roles, eq(users.roleId, roles.id))
        .where(where ? and(where, eq(roles.name, 'RIDER')) : eq(roles.name, 'RIDER'))
        .orderBy(users.name)
        .limit(perPage)
        .offset((page - 1) * perPage),
      this.database.db
        .select({ count: sql<number>`count(*)` })
        .from(riders)
        .innerJoin(users, eq(riders.userId, users.id))
        .innerJoin(roles, eq(users.roleId, roles.id))
        .where(where ? and(where, eq(roles.name, 'RIDER')) : eq(roles.name, 'RIDER')),
    ]);

    const total = Number(countResult[0]?.count ?? 0);
    return {
      data: rows.map(toRiderResponse),
      meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    };
  }

  async getById(id: string): Promise<RiderResponseDto> {
    return toRiderResponse(await this.riderOrThrow(id));
  }

  async listAssignable(): Promise<AssignableRiderResponseDto[]> {
    return this.database.db
      .select({ id: riders.id, name: users.name })
      .from(riders)
      .innerJoin(users, eq(riders.userId, users.id))
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(and(eq(users.status, 'ACTIVE'), eq(roles.name, 'RIDER')))
      .orderBy(users.name);
  }

  async create(dto: CreateRiderDto): Promise<RiderResponseDto> {
    const role = await this.database.db.query.roles.findFirst({
      where: eq(roles.name, 'RIDER'),
      columns: { id: true },
    });
    if (!role) throw new NotFoundException("Role 'RIDER' not found");

    try {
      const riderId = await this.database.db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({
            name: dto.name.trim(),
            email: normalizeEmail(dto.email),
            phone: dto.phone ?? null,
            passwordHash: await hashPassword(dto.password),
            passwordChangedAt: new Date(),
            roleId: role.id,
            status: dto.status ?? 'ACTIVE',
          })
          .returning({ id: users.id });
        const [rider] = await tx
          .insert(riders)
          .values({
            userId: user.id,
            vehicleType: dto.vehicleType ?? 'BIKE',
            vehiclePlate: dto.vehiclePlate ?? null,
            licenseNo: dto.licenseNo ?? null,
            nrcNumber: dto.nrcNumber ?? null,
            emergencyContactPhone: dto.emergencyContactPhone ?? null,
            notes: dto.notes ?? null,
          })
          .returning({ id: riders.id });
        return rider.id;
      });
      return this.getById(riderId);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `Rider with email '${normalizeEmail(dto.email)}' already exists`,
        );
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateRiderDto): Promise<RiderResponseDto> {
    const existing = await this.riderOrThrow(id);
    const email = dto.email ? normalizeEmail(dto.email) : undefined;
    const passwordHash = dto.password
      ? await hashPassword(dto.password)
      : undefined;

    if (email && email !== existing.email) {
      const emailOwner = await this.database.db.query.users.findFirst({
        where: eq(users.email, email),
        columns: { id: true },
      });
      if (emailOwner) {
        throw new ConflictException(`User with email '${email}' already exists`);
      }
    }

    try {
      await this.database.db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({
            ...(dto.name !== undefined && { name: dto.name.trim() }),
            ...(email !== undefined && { email }),
            ...(dto.phone !== undefined && { phone: dto.phone }),
            ...(dto.status !== undefined && { status: dto.status }),
            ...(passwordHash !== undefined && {
              passwordHash,
              passwordChangedAt: new Date(),
            }),
            updatedAt: new Date(),
          })
          .where(eq(users.id, existing.userId));
        await tx
          .update(riders)
          .set({
            ...(dto.vehicleType !== undefined && { vehicleType: dto.vehicleType }),
            ...(dto.vehiclePlate !== undefined && { vehiclePlate: dto.vehiclePlate }),
            ...(dto.licenseNo !== undefined && { licenseNo: dto.licenseNo }),
            ...(dto.nrcNumber !== undefined && { nrcNumber: dto.nrcNumber }),
            ...(dto.emergencyContactPhone !== undefined && {
              emergencyContactPhone: dto.emergencyContactPhone,
            }),
            ...(dto.notes !== undefined && { notes: dto.notes }),
            updatedAt: new Date(),
          })
          .where(eq(riders.id, id));
      });
      return this.getById(id);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(`User with email '${email}' already exists`);
      }
      throw err;
    }
  }

  async remove(id: string): Promise<void> {
    const existing = await this.riderOrThrow(id);
    await this.database.db.transaction(async (tx) => {
      await tx.delete(riders).where(eq(riders.id, id));
      await tx.delete(users).where(eq(users.id, existing.userId));
    });
  }

  private async riderOrThrow(id: string): Promise<RiderJoinedRow> {
    const [row] = await this.database.db
      .select({
        riderId: riders.id,
        userId: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        status: users.status,
        vehicleType: riders.vehicleType,
        vehiclePlate: riders.vehiclePlate,
        licenseNo: riders.licenseNo,
        nrcNumber: riders.nrcNumber,
        emergencyContactPhone: riders.emergencyContactPhone,
        notes: riders.notes,
        createdAt: riders.createdAt,
        updatedAt: riders.updatedAt,
      })
      .from(riders)
      .innerJoin(users, eq(riders.userId, users.id))
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(and(eq(riders.id, id), eq(roles.name, 'RIDER')));
    if (!row) throw new NotFoundException(`Rider '${id}' not found`);
    return row;
  }
}
