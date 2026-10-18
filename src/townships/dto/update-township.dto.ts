import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

export class UpdateTownshipDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^\d{1,10}(\.\d{1,2})?$/) defaultDeliveryFee?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^\d{1,10}(\.\d{1,2})?$/) defaultCommissionFee?: string;
  @ApiPropertyOptional({ minimum: 0 }) @IsOptional() @IsInt() @Min(0) leadTimeDays?: number;
}
