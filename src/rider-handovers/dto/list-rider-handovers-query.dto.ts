import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';
import { HANDOVER_METHODS, type HandoverMethod } from '../rider-handover.schema.js';

export class ListRiderHandoversQueryDto {
  @ApiPropertyOptional({ description: 'Filter by rider id' }) @IsOptional() @IsUUID() riderId?: string;

  @ApiPropertyOptional({ enum: HANDOVER_METHODS }) @IsOptional() @IsEnum(HANDOVER_METHODS) method?: HandoverMethod;

  @ApiPropertyOptional({ example: '2026-10-01', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }) @IsOptional() @IsDateString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-10-31', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }) @IsOptional() @IsDateString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateTo?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 500 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) perPage = 50;
}
