import { ApiProperty } from '@nestjs/swagger';

export class RiderOrderResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() trackingCode: string;
  @ApiProperty() customerName: string;
  @ApiProperty({ nullable: true }) customerPhone: string | null;
  @ApiProperty({ nullable: true }) customerAddress: string | null;
  @ApiProperty({ nullable: true }) townshipName: string | null;
  @ApiProperty({ nullable: true }) notes: string | null;
  @ApiProperty({ example: '47000.00' }) packagePrice: string;
  @ApiProperty({ example: '3500.00' }) deliveryFee: string;
  @ApiProperty({ example: '50500.00' }) codToCollect: string;
  @ApiProperty({ enum: ['ASSIGNED'] }) status: 'ASSIGNED';
}
