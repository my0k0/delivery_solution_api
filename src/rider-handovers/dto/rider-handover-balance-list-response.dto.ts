import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../users/dto/user-list-response.dto.js';
import { RiderHandoverBalanceResponseDto } from './rider-handover-response.dto.js';

export class RiderHandoverBalanceListResponseDto {
  @ApiProperty({ type: RiderHandoverBalanceResponseDto, isArray: true })
  data: RiderHandoverBalanceResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
