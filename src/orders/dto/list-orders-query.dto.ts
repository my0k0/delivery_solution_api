import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ORDER_STATUSES, type OrderStatus } from '../order.schema.js';

export const ORDER_DATE_BASES = ['ENTRY', 'DELIVERED'] as const;
export type OrderDateBasis = (typeof ORDER_DATE_BASES)[number];

/**
 * `NOT_ADVANCED` is a work list, not a null scan: orders that need an advance
 * and do not have one (not customer-prepaid, not cancelled). `ADVANCED` is every
 * order with an advance recorded, whatever its status.
 */
export const SHOP_ADVANCE_FILTERS = ['ADVANCED', 'NOT_ADVANCED'] as const;
export type ShopAdvanceFilter = (typeof SHOP_ADVANCE_FILTERS)[number];

export class ListOrdersQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  perPage?: number = 20;

  @ApiPropertyOptional({ description: 'Search by tracking code, customer name, phone, or delivery address' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ORDER_STATUSES, enumName: 'OrderStatus' })
  @IsOptional()
  @IsEnum(ORDER_STATUSES)
  status?: OrderStatus;

  @ApiPropertyOptional({ description: 'Filter by shop id' })
  @IsOptional()
  @IsUUID()
  shopId?: string;

  @ApiPropertyOptional({ description: 'Filter by township id' })
  @IsOptional()
  @IsUUID()
  townshipId?: string;

  @ApiPropertyOptional({ description: 'Filter by rider or partner id' })
  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ enum: ORDER_DATE_BASES, default: 'ENTRY' })
  @IsOptional()
  @IsEnum(ORDER_DATE_BASES)
  dateBasis?: OrderDateBasis = 'ENTRY';

  @ApiPropertyOptional({ description: 'Filter by customer id' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({
    enum: SHOP_ADVANCE_FILTERS,
    description:
      'ADVANCED = an advance is recorded. NOT_ADVANCED = an advance is still due (not customer-prepaid, not cancelled).',
  })
  @IsOptional()
  @IsEnum(SHOP_ADVANCE_FILTERS)
  shopAdvance?: ShopAdvanceFilter;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Filter by whether the customer paid the shop for the package',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  isPackagePaidToShop?: boolean;
}
