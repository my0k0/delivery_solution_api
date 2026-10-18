import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for recording or clearing a shop advance. There is deliberately no
 * `amount`: the advance is always exactly the order's package price, snapshotted
 * server-side (see the design, decision 4), so an override cannot exist.
 *
 * `reason` is required only when the order is DELIVERED — a settled cost is
 * changing, which the API allows only with `orders.update_after_approval`.
 */
export class ShopAdvanceDto {
  @ApiPropertyOptional({
    maxLength: 1000,
    description:
      'Required when the order is DELIVERED; recorded on the field audit rows',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
