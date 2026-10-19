import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/auth/auth.constants.js';
import { RequirePermissions } from '../common/auth/permissions.decorator.js';
import { CreateRiderHandoverDto } from './dto/create-rider-handover.dto.js';
import { ListRiderHandoversQueryDto } from './dto/list-rider-handovers-query.dto.js';
import { RiderHandoverAuditResponseDto } from './dto/rider-handover-audit-response.dto.js';
import { RiderHandoverBalanceListResponseDto } from './dto/rider-handover-balance-list-response.dto.js';
import { RiderHandoverBalancesQueryDto } from './dto/rider-handover-balances-query.dto.js';
import { RiderHandoverListResponseDto } from './dto/rider-handover-list-response.dto.js';
import { RiderHandoverResponseDto } from './dto/rider-handover-response.dto.js';
import { UpdateRiderHandoverDto } from './dto/update-rider-handover.dto.js';
import { RiderHandoversService } from './rider-handovers.service.js';

@ApiTags('Rider handovers')
@ApiBearerAuth('access-token')
@Controller({ path: 'rider-handovers', version: '1' })
export class RiderHandoversController {
  constructor(private readonly riderHandoversService: RiderHandoversService) {}

  @Get()
  @RequirePermissions('rider-handovers.read')
  @ApiOperation({ summary: 'List recorded handovers with filters and pagination' })
  @ApiOkResponse({ type: RiderHandoverListResponseDto })
  list(@Query() query: ListRiderHandoversQueryDto): Promise<RiderHandoverListResponseDto> {
    return this.riderHandoversService.list(query);
  }

  /**
   * Declared before any `:id` route: a literal path segment has to be matched
   * first, or the UUID pipe would reject `balances` as a malformed id.
   */
  @Get('balances')
  @RequirePermissions('rider-handovers.read')
  @ApiOperation({ summary: 'Per-rider delivered COD, accepted cash and the balance between them' })
  @ApiOkResponse({ type: RiderHandoverBalanceListResponseDto })
  listBalances(
    @Query() query: RiderHandoverBalancesQueryDto,
  ): Promise<RiderHandoverBalanceListResponseDto> {
    return this.riderHandoversService.listBalances(query);
  }

  @Post()
  @RequirePermissions('rider-handovers.create')
  @ApiOperation({ summary: 'Record cash a rider has handed back' })
  @ApiCreatedResponse({ type: RiderHandoverResponseDto })
  create(
    @Body() input: CreateRiderHandoverDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<RiderHandoverResponseDto> {
    return this.riderHandoversService.create(input, currentUser.id);
  }

  @Get(':id/audit')
  @RequirePermissions('rider-handovers.read')
  @ApiOperation({ summary: 'Per-field history of a handover that has been corrected' })
  @ApiOkResponse({ type: [RiderHandoverAuditResponseDto] })
  getAudit(@Param('id', ParseUUIDPipe) id: string): Promise<RiderHandoverAuditResponseDto[]> {
    return this.riderHandoversService.getAudit(id);
  }

  @Patch(':id')
  @RequirePermissions('rider-handovers.update')
  @ApiOperation({ summary: 'Correct a handover in place; the reason is required' })
  @ApiOkResponse({ type: RiderHandoverResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateRiderHandoverDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<RiderHandoverResponseDto> {
    return this.riderHandoversService.update(id, input, currentUser.id);
  }
}
