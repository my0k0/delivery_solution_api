import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { USER_STATUSES, type UserStatus } from '../../users/user.schema.js';
import {
  RIDER_VEHICLE_TYPES,
  type RiderVehicleType,
} from '../rider.schema.js';

export class UpdateRiderDto {
  @ApiPropertyOptional({ example: 'John Rider Updated' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'john.updated@delivery.local' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '09876543210', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string | null;

  @ApiPropertyOptional({ enum: USER_STATUSES })
  @IsOptional()
  @IsEnum(USER_STATUSES)
  status?: UserStatus;

  @ApiPropertyOptional({ description: 'Reset rider password' })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password?: string;

  @ApiPropertyOptional({ enum: RIDER_VEHICLE_TYPES, default: 'BIKE' })
  @IsOptional()
  @IsEnum(RIDER_VEHICLE_TYPES)
  vehicleType?: RiderVehicleType;

  @ApiPropertyOptional({ example: 'MDY-1234', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  vehiclePlate?: string | null;

  @ApiPropertyOptional({ example: 'DL-2024-99812', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  licenseNo?: string | null;

  @ApiPropertyOptional({ example: '09/LaMaNa(N)123456', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  nrcNumber?: string | null;

  @ApiPropertyOptional({ example: '09111111111', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  emergencyContactPhone?: string | null;

  @ApiPropertyOptional({ example: 'Prefers north townships', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}
