import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ORDER_STATUSES,
  type AssigneeType,
  type OrderStatus,
} from '../order.schema.js';

export class OrderResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() trackingCode: string;
  @ApiProperty() shopId: string;
  @ApiProperty() customerId: string;
  @ApiPropertyOptional({ nullable: true }) townshipId: string | null;
  @ApiPropertyOptional({ enum: ['RIDER', 'PARTNER'], nullable: true })
  assigneeType: AssigneeType | null;
  @ApiPropertyOptional({ nullable: true }) riderId: string | null;
  @ApiPropertyOptional({ nullable: true }) partnerId: string | null;
  @ApiPropertyOptional({ nullable: true }) partnerTrackingNo: string | null;
  @ApiPropertyOptional({ type: Object, nullable: true })
  packageInfo: Record<string, unknown> | null;
  @ApiProperty({ example: '47000.00', description: 'Decimal string' })
  packagePrice: string;
  @ApiProperty({ example: '3500.00', description: 'Decimal string' })
  deliveryFee: string;
  @ApiProperty({ example: '500.00', description: 'Rider commission for this order; not exposed to shop users' })
  commissionFee: string;
  @ApiProperty({
    example: '47000.00',
    description:
      'Package price the company advanced this shop for this order, snapshotted when the advance was recorded. Independent of later packagePrice edits; not exposed to shop users',
  })
  shopAdvanceAmount: string;
  @ApiPropertyOptional({
    nullable: true,
    description: 'When the advance was paid; null = not yet advanced',
  })
  shopAdvancedAt: string | null;
  @ApiProperty() isPackagePaidToShop: boolean;
  @ApiProperty() isFeePaidToShop: boolean;
  @ApiProperty({ description: 'Internal partner cost; not exposed to shop users' })
  partnerFee: string;
  @ApiPropertyOptional({ nullable: true, example: '2026-10-20' })
  estimatedDeliveryDate: string | null;
  @ApiPropertyOptional({ nullable: true }) deliveredAt: string | null;
  @ApiPropertyOptional({ nullable: true }) deliveryAddress: string | null;
  @ApiPropertyOptional({ nullable: true }) cancelReason: string | null;
  @ApiProperty({ enum: ORDER_STATUSES, enumName: 'OrderStatus' })
  status: OrderStatus;
  @ApiPropertyOptional({ nullable: true }) notes: string | null;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
}
