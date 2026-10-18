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
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/auth/auth.constants.js';
import { RequirePermissions } from '../common/auth/permissions.decorator.js';
import { AssignOrderDto } from './dto/assign-order.dto.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto.js';
import { OrderDetailResponseDto } from './dto/order-detail-response.dto.js';
import { OrderFieldAuditResponseDto } from './dto/order-field-audit-response.dto.js';
import { OrderHistoryResponseDto } from './dto/order-history-response.dto.js';
import { OrderListResponseDto } from './dto/order-list-response.dto.js';
import { OrderReasonDto } from './dto/order-reason.dto.js';
import { OrderResponseDto } from './dto/order-response.dto.js';
import { SendBackOrderDto } from './dto/send-back-order.dto.js';
import { ShopAdvanceDto } from './dto/shop-advance.dto.js';
import { UpdateOrderDto } from './dto/update-order.dto.js';
import { OrdersService } from './orders.service.js';

@ApiTags('Orders')
@ApiBearerAuth('access-token')
@Controller({ path: 'orders', version: '1' })
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'List orders with filters and pagination' })
  @ApiOkResponse({ type: OrderListResponseDto })
  list(@Query() query: ListOrdersQueryDto): Promise<OrderListResponseDto> {
    return this.ordersService.list(query);
  }

  @Post()
  @RequirePermissions('orders.create')
  @ApiOperation({ summary: 'Create an order using township defaults where available' })
  @ApiCreatedResponse({ type: OrderResponseDto })
  create(
    @Body() input: CreateOrderDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<OrderResponseDto> {
    return this.ordersService.create(input, currentUser.id);
  }

  @Get(':id/audit')
  @RequirePermissions('orders.read')
  @ApiOkResponse({ type: [OrderFieldAuditResponseDto] })
  getAudit(@Param('id', ParseUUIDPipe) id: string): Promise<OrderFieldAuditResponseDto[]> {
    return this.ordersService.getAudit(id);
  }

  @Get(':id/history')
  @RequirePermissions('orders.read')
  @ApiOkResponse({ type: [OrderHistoryResponseDto] })
  history(@Param('id', ParseUUIDPipe) id: string): Promise<OrderHistoryResponseDto[]> {
    return this.ordersService.getHistory(id);
  }

  @Post(':id/assign')
  @RequirePermissions('orders.update')
  @HttpCode(200)
  @ApiOkResponse({ type: OrderResponseDto })
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: AssignOrderDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<OrderResponseDto> {
    return this.ordersService.assign(id, input, currentUser.id);
  }

  @Post(':id/postpone')
  @RequirePermissions('orders.update')
  @HttpCode(200)
  @ApiOkResponse({ type: OrderResponseDto })
  postpone(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: OrderReasonDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<OrderResponseDto> {
    return this.ordersService.postpone(id, input, currentUser.id);
  }

  @Post(':id/cancel')
  @RequirePermissions('orders.cancel')
  @HttpCode(200)
  @ApiOkResponse({ type: OrderResponseDto })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: OrderReasonDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<OrderResponseDto> {
    return this.ordersService.cancel(id, input, currentUser.id);
  }

  @Post(':id/approve')
  @RequirePermissions('deliveries.approve')
  @HttpCode(200)
  @ApiOkResponse({ type: OrderResponseDto })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<OrderResponseDto> {
    return this.ordersService.approve(id, currentUser.id);
  }

  @Post(':id/send-back')
  @RequirePermissions('deliveries.approve')
  @HttpCode(200)
  @ApiOkResponse({ type: OrderResponseDto })
  sendBack(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: SendBackOrderDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<OrderResponseDto> {
    return this.ordersService.sendBack(id, input, currentUser.id);
  }

  @Post(':id/mark-delivered')
  @RequirePermissions('deliveries.approve')
  @HttpCode(200)
  @ApiOkResponse({ type: OrderResponseDto })
  markPartnerDelivered(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<OrderResponseDto> {
    return this.ordersService.markPartnerDelivered(id, currentUser.id);
  }

  @Post(':id/shop-advance')
  @RequirePermissions('orders.shop_settlement')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Record that the company advanced the package price to the shop. No amount is accepted; the package price is snapshotted.',
  })
  @ApiOkResponse({ type: OrderResponseDto })
  recordShopAdvance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ShopAdvanceDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<OrderResponseDto> {
    return this.ordersService.recordShopAdvance(id, input, currentUser.id, currentUser.roleId);
  }

  @Delete(':id/shop-advance')
  @RequirePermissions('orders.shop_settlement')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Clear a recorded shop advance. Refused on a cancelled order, where the advance is money owed back.',
  })
  @ApiOkResponse({ type: OrderResponseDto })
  clearShopAdvance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ShopAdvanceDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<OrderResponseDto> {
    return this.ordersService.clearShopAdvance(id, input, currentUser.id, currentUser.roleId);
  }

  @Patch(':id')
  @RequirePermissions('orders.update')
  @ApiOkResponse({ type: OrderResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateOrderDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<OrderResponseDto> {
    return this.ordersService.update(id, input, currentUser.id);
  }

  @Get(':id')
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'Get an order and its status history' })
  @ApiOkResponse({ type: OrderDetailResponseDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<OrderDetailResponseDto> {
    return this.ordersService.getById(id);
  }
}
