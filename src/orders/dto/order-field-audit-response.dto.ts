import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OrderFieldAuditResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() orderId: string;
  @ApiProperty() field: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      "Previous value. Identifier-valued fields (`shopId`, `customerId`, `townshipId`, `riderId`, `partnerId`) are resolved to the referenced record's name; `Unknown` marks a record that no longer exists.",
  })
  oldValue: unknown;

  @ApiPropertyOptional({
    nullable: true,
    description: 'New value; identifiers resolved the same way as `oldValue`.',
  })
  newValue: unknown;
  @ApiPropertyOptional({ nullable: true }) actorId: string | null;
  @ApiPropertyOptional({ nullable: true }) reason: string | null;
  @ApiProperty() createdAt: string;
}
