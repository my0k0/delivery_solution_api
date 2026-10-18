import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Matches, MaxLength, Min } from 'class-validator';

export class CreateTownshipDto {
  @ApiProperty() @IsString() @MaxLength(120) name: string;
  @ApiProperty({ example: '3500.00' }) @IsString() @Matches(/^\d{1,10}(\.\d{1,2})?$/) defaultDeliveryFee: string;
  @ApiProperty({ example: '500.00' }) @IsString() @Matches(/^\d{1,10}(\.\d{1,2})?$/) defaultCommissionFee: string;
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) leadTimeDays: number;
}
