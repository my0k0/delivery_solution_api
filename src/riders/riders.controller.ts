import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../common/auth/permissions.decorator.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/auth/auth.constants.js';
import { OrdersService } from '../orders/orders.service.js';
import { RiderDeliveredResponseDto } from './dto/rider-delivered-response.dto.js';
import { RiderOrderResponseDto } from './dto/rider-order-response.dto.js';
import { CreateRiderDto } from './dto/create-rider.dto.js';
import { ListRidersQueryDto } from './dto/list-riders-query.dto.js';
import { RiderListResponseDto } from './dto/rider-list-response.dto.js';
import { RiderResponseDto } from './dto/rider-response.dto.js';
import { UpdateRiderDto } from './dto/update-rider.dto.js';
import { AssignableRiderResponseDto } from './dto/assignable-rider-response.dto.js';
import { RidersService } from './riders.service.js';

@ApiTags('Riders')
@ApiBearerAuth('access-token')
@Controller({ path: 'riders', version: '1' })
export class RidersController {
  constructor(
    private readonly ridersService: RidersService,
    private readonly ordersService: OrdersService,
  ) {}

  @Get('me/orders')
  @RequirePermissions('deliveries.read')
  @ApiOperation({ summary: 'List the authenticated rider’s assigned orders' })
  @ApiOkResponse({ type: [RiderOrderResponseDto] })
  listMyOrders(
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<RiderOrderResponseDto[]> {
    return this.ordersService.listRiderAssignedOrders(currentUser.id);
  }

  @Post('me/orders/:id/delivered')
  @RequirePermissions('deliveries.update')
  @HttpCode(200)
  @ApiOperation({ summary: 'Submit an owned order delivery for office approval' })
  @ApiOkResponse({ type: RiderDeliveredResponseDto })
  submitDelivered(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<RiderDeliveredResponseDto> {
    return this.ordersService.submitRiderDelivered(id, currentUser.id);
  }

  @Get('assignable')
  @RequirePermissions('orders.create')
  @ApiOperation({ summary: 'List active riders available for order assignment' })
  @ApiOkResponse({ type: [AssignableRiderResponseDto] })
  listAssignable(): Promise<AssignableRiderResponseDto[]> {
    return this.ridersService.listAssignable();
  }

  @Get()
  @RequirePermissions('riders.read')
  @ApiOperation({ summary: 'List riders with search, filters and pagination' })
  @ApiOkResponse({ type: RiderListResponseDto })
  list(@Query() query: ListRidersQueryDto): Promise<RiderListResponseDto> {
    return this.ridersService.list(query);
  }

  @Post()
  @RequirePermissions('riders.create')
  @ApiOperation({ summary: 'Create a rider and its login account' })
  @ApiCreatedResponse({ type: RiderResponseDto })
  create(@Body() dto: CreateRiderDto): Promise<RiderResponseDto> {
    return this.ridersService.create(dto);
  }

  @Get(':id')
  @RequirePermissions('riders.read')
  @ApiOperation({ summary: 'Get a rider by id' })
  @ApiOkResponse({ type: RiderResponseDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<RiderResponseDto> {
    return this.ridersService.getById(id);
  }

  @Patch(':id')
  @RequirePermissions('riders.update')
  @ApiOperation({ summary: 'Update a rider and its login account' })
  @ApiOkResponse({ type: RiderResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRiderDto,
  ): Promise<RiderResponseDto> {
    return this.ridersService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('riders.delete')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a rider and its login account' })
  @ApiNoContentResponse()
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.ridersService.remove(id);
  }
}
