import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ORDER_STATUSES, type OrderStatus } from '../order.schema.js';

export class OrderHistoryResponseDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id: string;

  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  orderId: string;

  @ApiPropertyOptional({
    enum: ORDER_STATUSES,
    enumName: 'OrderStatus',
    nullable: true,
  })
  fromStatus: OrderStatus | null;

  @ApiProperty({ enum: ORDER_STATUSES, enumName: 'OrderStatus' })
  toStatus: OrderStatus;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Id of the acting user. `changedByName` is what a reader shows; this stays for correlation.',
  })
  changedBy: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Resolved name of the acting user; null when the actor was deleted.',
  })
  changedByName: string | null;

  @ApiPropertyOptional({ nullable: true })
  note: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Shop-visible state-change reason' })
  reason: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Internal-only state-change note' })
  internalNote: string | null;

  @ApiPropertyOptional({ nullable: true, type: Object })
  previousAssignee: { type: 'RIDER' | 'PARTNER'; riderId: string | null; partnerId: string | null } | null;

  @ApiPropertyOptional({ nullable: true, type: Object })
  newAssignee: { type: 'RIDER' | 'PARTNER'; riderId: string | null; partnerId: string | null } | null;

  @ApiProperty({ example: '2026-09-18T10:00:00.000Z' })
  createdAt: string;
}
