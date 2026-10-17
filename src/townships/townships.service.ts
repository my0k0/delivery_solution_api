import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../common/database/database.service.js';
import { deliveryPartners } from '../delivery-partners/delivery-partner.schema.js';
import { orders } from '../orders/order.schema.js';
import { riders } from '../riders/rider.schema.js';
import { isUniqueViolation } from '../common/database/is-unique-violation.js';
import { CreateTownshipDto } from './dto/create-township.dto.js';
import { UpdateTownshipDto } from './dto/update-township.dto.js';
import { TownshipResponseDto } from './dto/township-response.dto.js';
import { townships } from './township.schema.js';

type TownshipRow = typeof townships.$inferSelect;

function toTownshipResponse(row: TownshipRow): TownshipResponseDto {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

@Injectable()
export class TownshipsService {
  constructor(private readonly database: DatabaseService) {}

  async list(): Promise<TownshipResponseDto[]> {
    const rows = await this.database.db.select().from(townships).orderBy(townships.name);
    return rows.map(toTownshipResponse);
  }

  async getById(id: string): Promise<TownshipResponseDto> {
    return toTownshipResponse(await this.townshipOrThrow(id));
  }

  async create(input: CreateTownshipDto): Promise<TownshipResponseDto> {
    await this.assertDefaultAssignee(input);
    try {
      const [row] = await this.database.db.insert(townships).values({
        name: input.name.trim(),
        defaultDeliveryFee: input.defaultDeliveryFee,
        defaultCommissionFee: input.defaultCommissionFee,
        leadTimeDays: input.leadTimeDays,
        defaultAssigneeType: input.defaultAssigneeType ?? null,
        defaultRiderId: input.defaultRiderId ?? null,
        defaultPartnerId: input.defaultPartnerId ?? null,
      }).returning();
      return toTownshipResponse(row);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(`Township '${input.name.trim()}' already exists`);
      throw error;
    }
  }

  async update(id: string, input: UpdateTownshipDto): Promise<TownshipResponseDto> {
    const existing = await this.townshipOrThrow(id);
    const updated = { ...existing, ...input };
    await this.assertDefaultAssignee(updated);
    try {
      const [row] = await this.database.db.update(townships).set({
        ...(input.name !== undefined && { name: input.name.trim() }),
        ...(input.defaultDeliveryFee !== undefined && { defaultDeliveryFee: input.defaultDeliveryFee }),
        ...(input.defaultCommissionFee !== undefined && { defaultCommissionFee: input.defaultCommissionFee }),
        ...(input.leadTimeDays !== undefined && { leadTimeDays: input.leadTimeDays }),
        ...(input.defaultAssigneeType !== undefined && { defaultAssigneeType: input.defaultAssigneeType }),
        ...(input.defaultRiderId !== undefined && { defaultRiderId: input.defaultRiderId }),
        ...(input.defaultPartnerId !== undefined && { defaultPartnerId: input.defaultPartnerId }),
        updatedAt: new Date(),
      }).where(eq(townships.id, id)).returning();
      return toTownshipResponse(row);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(`Township '${input.name?.trim()}' already exists`);
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    const township = await this.townshipOrThrow(id);

    // orders.townshipId is onDelete: 'restrict'. Block the delete with a real
    // message rather than letting the FK violation surface as a 500.
    const referencing = Number(
      (
        await this.database.db
          .select({ c: sql<number>`count(*)` })
          .from(orders)
          .where(eq(orders.townshipId, id))
      )[0]?.c ?? 0,
    );
    if (referencing > 0) {
      throw new ConflictException(
        `${referencing} order(s) still use township '${township.name}'. Reassign or delete them first.`,
      );
    }

    await this.database.db.delete(townships).where(eq(townships.id, id));
  }

  private async townshipOrThrow(id: string): Promise<TownshipRow> {
    const row = await this.database.db.query.townships.findFirst({ where: eq(townships.id, id) });
    if (!row) throw new NotFoundException(`Township '${id}' not found`);
    return row;
  }

  private async assertDefaultAssignee(value: Partial<Pick<TownshipRow, 'defaultAssigneeType' | 'defaultRiderId' | 'defaultPartnerId'>>): Promise<void> {
    const defaultAssigneeType = value.defaultAssigneeType ?? null;
    const defaultRiderId = value.defaultRiderId ?? null;
    const defaultPartnerId = value.defaultPartnerId ?? null;
    const isUnassigned = defaultAssigneeType === null && defaultRiderId === null && defaultPartnerId === null;
    const isRider = defaultAssigneeType === 'RIDER' && defaultRiderId !== null && defaultPartnerId === null;
    const isPartner = defaultAssigneeType === 'PARTNER' && defaultPartnerId !== null && defaultRiderId === null;
    if (!isUnassigned && !isRider && !isPartner) throw new BadRequestException('Default assignee type and id must match');
    if (isRider && defaultRiderId && !await this.database.db.query.riders.findFirst({ where: eq(riders.id, defaultRiderId), columns: { id: true } })) {
      throw new BadRequestException('Default rider not found');
    }
    if (isPartner && defaultPartnerId && !await this.database.db.query.deliveryPartners.findFirst({ where: eq(deliveryPartners.id, defaultPartnerId), columns: { id: true } })) {
      throw new BadRequestException('Default delivery partner not found');
    }
  }
}
