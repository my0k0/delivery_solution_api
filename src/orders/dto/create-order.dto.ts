import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

export class CreateOrderDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  @IsUUID()
  shopId: string;

  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  @IsUUID()
  customerId: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  townshipId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Omitted uses the township default; null leaves the order pending.' })
  @IsOptional()
  @IsUUID()
  riderId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Omitted uses the township default; null leaves the order pending.' })
  @IsOptional()
  @IsUUID()
  partnerId?: string | null;

  @ApiPropertyOptional({ description: 'Opaque package metadata', type: Object, nullable: true })
  @IsOptional()
  @IsObject()
  packageInfo?: Record<string, unknown> | null;

  @ApiPropertyOptional({ example: '47000.00', default: '0' })
  @IsOptional()
  @IsString()
  @Matches(MONEY_PATTERN)
  packagePrice?: string;

  @ApiPropertyOptional({ example: '3500.00', description: 'Overrides the township default fee' })
  @IsOptional()
  @IsString()
  @Matches(MONEY_PATTERN)
  deliveryFee?: string;

  @ApiPropertyOptional({ example: '500.00', description: 'Rider commission for this order; overrides the township default' })
  @IsOptional()
  @IsString()
  @Matches(MONEY_PATTERN)
  commissionFee?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPackagePaidToShop?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isFeePaidToShop?: boolean;

  @ApiPropertyOptional({ example: '500.00', default: '0' })
  @IsOptional()
  @IsString()
  @Matches(MONEY_PATTERN)
  partnerFee?: string;

  @ApiPropertyOptional({ nullable: true, example: '2026-10-20' })
  @IsOptional()
  @IsDateString()
  estimatedDeliveryDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  deliveryAddress?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Partner-provided tracking reference' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  partnerTrackingNo?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
