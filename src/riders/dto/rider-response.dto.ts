import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { USER_STATUSES, type UserStatus } from '../../users/user.schema.js';
import { RIDER_VEHICLE_TYPES, type RiderVehicleType } from '../rider.schema.js';

export class RiderResponseDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id: string;

  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  userId: string;

  @ApiProperty({ example: 'John Rider' })
  name: string;

  @ApiProperty({ example: 'john.rider@delivery.local' })
  email: string;

  @ApiPropertyOptional({ example: '09123456789', nullable: true })
  phone: string | null;

  @ApiProperty({ enum: USER_STATUSES, enumName: 'UserStatus' })
  status: UserStatus;

  @ApiProperty({ enum: RIDER_VEHICLE_TYPES, enumName: 'RiderVehicleType' })
  vehicleType: RiderVehicleType;

  @ApiPropertyOptional({ example: 'MDY-1234', nullable: true })
  vehiclePlate: string | null;

  @ApiPropertyOptional({ example: 'DL-2024-99812', nullable: true })
  licenseNo: string | null;

  @ApiPropertyOptional({ example: '09/LaMaNa(N)123456', nullable: true })
  nrcNumber: string | null;

  @ApiPropertyOptional({ example: '09111111111', nullable: true })
  emergencyContactPhone: string | null;

  @ApiPropertyOptional({ example: 'Prefers north townships', nullable: true })
  notes: string | null;

  @ApiProperty({ example: '2026-09-18T10:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-09-18T10:00:00.000Z' })
  updatedAt: string;
}
