import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RiderHandoverAuditResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() handoverId: string;
  @ApiProperty() field: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      "Previous value. A `riderId` change is resolved to the rider's name, the way the order audit resolves its identifier-valued fields; `Unknown` marks a record that no longer exists.",
  })
  oldValue: unknown;

  @ApiPropertyOptional({
    nullable: true,
    description: 'New value; identifiers resolved the same way as `oldValue`.',
  })
  newValue: unknown;
  @ApiPropertyOptional({ nullable: true }) actorId: string | null;
  @ApiPropertyOptional({ nullable: true }) actorName: string | null;
  @ApiPropertyOptional({ nullable: true }) reason: string | null;
  @ApiProperty() createdAt: string;
}
