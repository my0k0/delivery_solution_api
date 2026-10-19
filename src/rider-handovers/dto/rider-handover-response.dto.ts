import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { USER_STATUSES, type UserStatus } from '../../users/user.schema.js';
import { HANDOVER_METHODS, type HandoverMethod } from '../rider-handover.schema.js';

export class RiderHandoverResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() riderId: string;
  /** Resolved server-side: no office view renders an id. */
  @ApiProperty() riderName: string;
  @ApiProperty({ example: '12000.00' }) amount: string;
  @ApiProperty({ example: '2026-10-20' }) receivedOn: string;
  @ApiProperty({ enum: HANDOVER_METHODS }) method: HandoverMethod;
  @ApiPropertyOptional({ nullable: true }) note: string | null;
  @ApiPropertyOptional({ nullable: true }) recordedByName: string | null;
  @ApiProperty() createdAt: string;
  /**
   * Only moves on an edit, so `updatedAt !== createdAt` is what flags a
   * corrected row — the list does not have to carry the audit trail itself.
   */
  @ApiProperty() updatedAt: string;
}

export class RiderHandoverBalanceResponseDto {
  @ApiProperty() riderId: string;
  @ApiProperty() riderName: string;
  /** A deactivated rider keeps a visible balance, so arrears are not lost. */
  @ApiProperty({ enum: USER_STATUSES }) riderStatus: UserStatus;
  /** All-time COD of this rider's `DELIVERED` orders. */
  @ApiProperty({ example: '38000.00' }) deliveredCod: string;
  @ApiProperty({ example: '26000.00' }) accepted: string;
  /** `deliveredCod − accepted`: positive means the rider owes, negative means the company holds. */
  @ApiProperty({ example: '12000.00' }) balance: string;
  @ApiPropertyOptional({ nullable: true, example: '2026-10-18' }) lastReceivedOn: string | null;
  /**
   * Delivery date of the oldest delivery still carrying part of the balance, on
   * cash-settles-oldest-first. `null` when nothing is outstanding. Derived on
   * read — nothing is stored, so there is no allocation to keep in sync.
   */
  @ApiPropertyOptional({ nullable: true, example: '2026-10-12' }) oldestUnsettledDeliveredOn: string | null;
}
