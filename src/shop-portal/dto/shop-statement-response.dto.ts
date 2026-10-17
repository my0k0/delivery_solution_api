import { ApiProperty } from '@nestjs/swagger';

export class ShopStatementResponseDto {
  @ApiProperty() shopName!: string;
  @ApiProperty() dateFrom!: string;
  @ApiProperty() dateTo!: string;
  @ApiProperty() dateBasis!: string;
  @ApiProperty() receivedCount!: number;
  @ApiProperty() outForDeliveryCount!: number;
  @ApiProperty() deliveredCount!: number;
  @ApiProperty() cancelledCount!: number;
  @ApiProperty() priceTotal!: string;
  @ApiProperty() feeTotal!: string;
  @ApiProperty() codCollected!: string;
  @ApiProperty() codExpected!: string;
  @ApiProperty() netOwedToShopDelivered!: string;
  @ApiProperty() pendingNetOwedToShop!: string;
  @ApiProperty() netOwedToShopTotal!: string;
}
