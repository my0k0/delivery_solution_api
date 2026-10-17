import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateIf } from 'class-validator';
import { TOWNSHIP_DEFAULT_ASSIGNEE_TYPES, type TownshipDefaultAssigneeType } from '../township.schema.js';

export class UpdateTownshipDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^\d{1,10}(\.\d{1,2})?$/) defaultDeliveryFee?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^\d{1,10}(\.\d{1,2})?$/) defaultCommissionFee?: string;
  @ApiPropertyOptional({ minimum: 0 }) @IsOptional() @IsInt() @Min(0) leadTimeDays?: number;
  @ApiPropertyOptional({ enum: TOWNSHIP_DEFAULT_ASSIGNEE_TYPES, nullable: true })
  @IsOptional() @IsEnum(TOWNSHIP_DEFAULT_ASSIGNEE_TYPES) defaultAssigneeType?: TownshipDefaultAssigneeType | null;
  @ApiPropertyOptional({ nullable: true }) @ValidateIf((value: UpdateTownshipDto) => value.defaultRiderId !== null) @IsOptional() @IsUUID() defaultRiderId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @ValidateIf((value: UpdateTownshipDto) => value.defaultPartnerId !== null) @IsOptional() @IsUUID() defaultPartnerId?: string | null;
}
