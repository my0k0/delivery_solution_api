import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

/**
 * Money string capped at what `numeric(12,2)` stores: up to 10 integer digits
 * and at most 2 decimals. Matches `MONEY_PATTERN` in the order DTOs.
 */
const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

export class UpdateCommissionRateDto {
  @ApiProperty({ example: '500.00', pattern: '^\\d{1,10}(\\.\\d{1,2})?$' })
  @IsString()
  @Matches(MONEY_PATTERN)
  value!: string;
}
