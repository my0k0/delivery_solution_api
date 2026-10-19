import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { HANDOVER_METHODS, type HandoverMethod } from '../rider-handover.schema.js';

/**
 * A correction is an edit in place, so every field stays editable — and it
 * always carries a reason, which lands on each audit row this edit writes. There
 * is no delete: a duplicate or a reversed transfer is corrected to `0.00` with
 * the reason recording what happened.
 */
export class UpdateRiderHandoverDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() riderId?: string;

  @ApiPropertyOptional({ example: '12000.00' }) @IsOptional() @IsString() @Matches(/^\d{1,10}(\.\d{1,2})?$/) amount?: string;

  @ApiPropertyOptional({ example: '2026-10-20', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }) @IsOptional() @IsDateString() @Matches(/^\d{4}-\d{2}-\d{2}$/) receivedOn?: string;

  @ApiPropertyOptional({ enum: HANDOVER_METHODS }) @IsOptional() @IsEnum(HANDOVER_METHODS) method?: HandoverMethod;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(500) note?: string;

  @ApiProperty({ description: 'Why the handover is being corrected. Required on every edit.' })
  @IsString() @MinLength(1) @MaxLength(500) reason: string;
}
