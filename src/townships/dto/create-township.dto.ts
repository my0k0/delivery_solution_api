import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateIf } from 'class-validator';
import { TOWNSHIP_DEFAULT_ASSIGNEE_TYPES, type TownshipDefaultAssigneeType } from '../township.schema.js';

export class CreateTownshipDto {
  @ApiProperty() @IsString() @MaxLength(120) name: string;
  @ApiProperty({ example: '3500.00' }) @IsString() @Matches(/^\d{1,10}(\.\d{1,2})?$/) defaultDeliveryFee: string;
  @ApiProperty({ example: '500.00' }) @IsString() @Matches(/^\d{1,10}(\.\d{1,2})?$/) defaultCommissionFee: string;
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) leadTimeDays: number;
  @ApiPropertyOptional({ enum: TOWNSHIP_DEFAULT_ASSIGNEE_TYPES, nullable: true })
  @IsOptional() @IsEnum(TOWNSHIP_DEFAULT_ASSIGNEE_TYPES) defaultAssigneeType?: TownshipDefaultAssigneeType | null;
  @ApiPropertyOptional({ nullable: true }) @ValidateIf((value: CreateTownshipDto) => value.defaultRiderId !== null) @IsOptional() @IsUUID() defaultRiderId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @ValidateIf((value: CreateTownshipDto) => value.defaultPartnerId !== null) @IsOptional() @IsUUID() defaultPartnerId?: string | null;
}
