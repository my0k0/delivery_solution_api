import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../users/dto/user-list-response.dto.js';
import { RiderHandoverResponseDto } from './rider-handover-response.dto.js';

export class RiderHandoverListResponseDto {
  @ApiProperty({ type: RiderHandoverResponseDto, isArray: true })
  data: RiderHandoverResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
