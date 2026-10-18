import { ApiProperty } from '@nestjs/swagger';

export class TownshipResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() defaultDeliveryFee: string;
  @ApiProperty() defaultCommissionFee: string;
  @ApiProperty() leadTimeDays: number;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
}
