import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderHistoryResponseDto } from './order-history-response.dto.js';
import { OrderResponseDto } from './order-response.dto.js';

/**
 * `OrderResponseDto` carries ids only. The office detail view must not show an
 * id, and an officer holds `orders.read` without `shops.read`, `customers.read`
 * or `riders.read`, so the referenced names are resolved here rather than by a
 * client that may not be allowed to fetch them.
 */
export class OrderDetailResponseDto extends OrderResponseDto {
  @ApiPropertyOptional({ nullable: true })
  shopName: string | null;

  @ApiPropertyOptional({ nullable: true })
  customerName: string | null;

  @ApiPropertyOptional({ nullable: true }) townshipName: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Name of the assigned rider or delivery partner; null when unassigned.',
  })
  assigneeName: string | null;

  @ApiProperty({ type: [OrderHistoryResponseDto] })
  history: OrderHistoryResponseDto[];
}
