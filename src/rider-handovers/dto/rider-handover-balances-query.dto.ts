import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * The balances table answers "who owes what right now", so its filters are about
 * riders and amounts. Method deliberately has no filter here — it belongs to the
 * history list, which knows when each handover actually arrived.
 */
export class RiderHandoverBalancesQueryDto {
  @ApiPropertyOptional({ description: 'Search by rider name' }) @IsOptional() @IsString() search?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Only riders whose balance is not exactly 0.00',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  outstandingOnly?: boolean;

  @ApiPropertyOptional({ default: 1, minimum: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 500 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) perPage = 50;
}
