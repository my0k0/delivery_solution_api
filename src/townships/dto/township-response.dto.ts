import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { TownshipDefaultAssigneeType } from '../township.schema.js';

export class TownshipResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() defaultDeliveryFee: string;
  @ApiProperty() defaultCommissionFee: string;
  @ApiProperty() leadTimeDays: number;
  @ApiPropertyOptional({ nullable: true }) defaultAssigneeType: TownshipDefaultAssigneeType | null;
  @ApiPropertyOptional({ nullable: true }) defaultRiderId: string | null;
  @ApiPropertyOptional({ nullable: true }) defaultPartnerId: string | null;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
}
