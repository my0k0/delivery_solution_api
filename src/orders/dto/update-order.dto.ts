import { ApiPropertyOptional } from '@nestjs/swagger';
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

export class UpdateOrderDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() shopId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() townshipId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() riderId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() partnerId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(200) partnerTrackingNo?: string | null;
  @ApiPropertyOptional({ nullable: true, type: Object }) @IsOptional() @IsObject() packageInfo?: Record<string, unknown> | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(MONEY_PATTERN) packagePrice?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(MONEY_PATTERN) deliveryFee?: string;
  @ApiPropertyOptional({ description: 'Rider commission for this order; overrides the township default' }) @IsOptional() @IsString() @Matches(MONEY_PATTERN) commissionFee?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPackagePaidToShop?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isFeePaidToShop?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(MONEY_PATTERN) partnerFee?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsDateString() estimatedDeliveryDate?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(2000) deliveryAddress?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
  @ApiPropertyOptional({ description: 'Apply the new township default delivery fee' })
  @IsOptional() @IsBoolean() applyTownshipFee?: boolean;
  @ApiPropertyOptional({ description: 'Apply the new township default assignee' })
  @IsOptional() @IsBoolean() applyTownshipAssignee?: boolean;
  @ApiPropertyOptional({ nullable: true, description: 'Audit reason for changed fields' })
  @IsOptional() @IsString() @MaxLength(1000) reason?: string | null;
}
