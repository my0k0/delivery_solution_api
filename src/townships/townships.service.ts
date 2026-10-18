import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../common/database/database.service.js';
import { orders } from '../orders/order.schema.js';
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
    try {
      const [row] = await this.database.db.insert(townships).values({
        name: input.name.trim(),
        defaultDeliveryFee: input.defaultDeliveryFee,
        defaultCommissionFee: input.defaultCommissionFee,
        leadTimeDays: input.leadTimeDays,
      }).returning();
      return toTownshipResponse(row);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(`Township '${input.name.trim()}' already exists`);
      throw error;
    }
  }

  async update(id: string, input: UpdateTownshipDto): Promise<TownshipResponseDto> {
    await this.townshipOrThrow(id);
    try {
      const [row] = await this.database.db.update(townships).set({
        ...(input.name !== undefined && { name: input.name.trim() }),
        ...(input.defaultDeliveryFee !== undefined && { defaultDeliveryFee: input.defaultDeliveryFee }),
        ...(input.defaultCommissionFee !== undefined && { defaultCommissionFee: input.defaultCommissionFee }),
        ...(input.leadTimeDays !== undefined && { leadTimeDays: input.leadTimeDays }),
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
}
