import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { HANDOVER_METHODS, type HandoverMethod } from '../rider-handover.schema.js';

export class CreateRiderHandoverDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() riderId: string;

  /**
   * The cash received — the full COD collected, never "COD minus commission".
   * The regex has no `-`, so a negative amount is unrepresentable rather than
   * something the service has to reject, and the table's `>= 0` check backs it.
   */
  @ApiProperty({ example: '12000.00' }) @IsString() @Matches(/^\d{1,10}(\.\d{1,2})?$/) amount: string;

  /** The day the office received it, `YYYY-MM-DD` — never the collection date. */
  @ApiProperty({ example: '2026-10-20', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }) @IsDateString() @Matches(/^\d{4}-\d{2}-\d{2}$/) receivedOn: string;

  @ApiProperty({ enum: HANDOVER_METHODS }) @IsEnum(HANDOVER_METHODS) method: HandoverMethod;

  /** Free text; the KPay reference belongs here. */
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(500) note?: string;
}
