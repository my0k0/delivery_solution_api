import { Controller, Get, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/auth/auth.constants.js';
import { RequirePermissions } from '../common/auth/permissions.decorator.js';
import { renderCsv, renderXlsx, reportFilename, type ExportRow } from '../reports/report-export.util.js';
import { ShopPortalService } from './shop-portal.service.js';
import { ShopOrdersExportQueryDto, ShopOrdersQueryDto, ShopStatementExportQueryDto, ShopStatementQueryDto, ShopDashboardQueryDto } from './dto/shop-portal-query.dto.js';
import { ShopOrderListResponseDto } from './dto/shop-order-list-response.dto.js';
import { ShopOrderDetailResponseDto } from './dto/shop-order-detail-response.dto.js';
import { ShopDashboardResponseDto } from './dto/shop-dashboard-response.dto.js';
import { ShopStatementResponseDto } from './dto/shop-statement-response.dto.js';

const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function sendExport(response: Response, format: 'csv' | 'xlsx', name: string, dateFrom: string, dateTo: string, headers: readonly string[], rows: readonly ExportRow[]): void {
  const content = format === 'csv' ? renderCsv(headers, rows) : renderXlsx(headers, rows);
  response.setHeader('Content-Type', format === 'csv' ? CSV_CONTENT_TYPE : XLSX_CONTENT_TYPE);
  response.setHeader('Content-Disposition', `attachment; filename="${reportFilename(name, dateFrom, dateTo, format)}"`);
  response.status(200).end(content);
}

@ApiTags('Shop Portal')
@ApiBearerAuth('access-token')
@Controller({ path: 'shop', version: '1' })
export class ShopPortalController {
  constructor(private readonly shopPortal: ShopPortalService) {}

  @Get('orders')
  @RequirePermissions('shop-portal.read')
  @ApiOperation({ summary: 'List the authenticated shop user’s orders' })
  @ApiOkResponse({ type: ShopOrderListResponseDto })
  getOrders(@CurrentUser() user: AuthenticatedUser, @Query() query: ShopOrdersQueryDto): Promise<ShopOrderListResponseDto> {
    return this.shopPortal.getOrders(user, query);
  }

  @Get('orders/export')
  @RequirePermissions('shop-reports.export')
  @ApiOperation({ summary: 'Export the authenticated shop user’s orders as CSV or XLSX' })
  @ApiProduces(CSV_CONTENT_TYPE, XLSX_CONTENT_TYPE)
  @ApiOkResponse({ description: 'Shop-safe report file attachment', schema: { type: 'string', format: 'binary' } })
  async exportOrders(@CurrentUser() user: AuthenticatedUser, @Query() query: ShopOrdersExportQueryDto, @Res() response: Response): Promise<void> {
    const report = await this.shopPortal.getOrdersForExport(user, query);
    const headers = [
      'trackingCode', 'customerName', 'customerPhone', 'deliveryAddress', 'townshipName',
      'packagePrice', 'deliveryFee', 'total', 'codToCollect', 'netOwedToShop',
      'isPackagePaidToShop', 'isFeePaidToShop', 'displayStatus', 'needsAttention',
      'createdAt', 'deliveredAt', 'estimatedDeliveryDate',
    ];
    const rows: ExportRow[] = report.rows.map(({ order }) => [
      order.trackingCode, order.customerName, order.customerPhone, order.deliveryAddress, order.townshipName,
      order.packagePrice, order.deliveryFee, order.total, order.codToCollect, order.netOwedToShop,
      order.isPackagePaidToShop, order.isFeePaidToShop, order.displayStatus, order.needsAttention,
      order.createdAt, order.deliveredAt, order.estimatedDeliveryDate,
    ]);
    rows.push([
      'TOTAL', '', '', '', '', report.totals.packagePrice, report.totals.deliveryFee, report.totals.total,
      report.totals.codToCollect, report.totals.netOwedToShop, '', '', '', '', '', '', '',
    ]);
    sendExport(response, query.format, 'shop-orders', report.dateFrom, report.dateTo, headers, rows);
  }

  @Get('orders/:id')
  @RequirePermissions('shop-portal.read')
  @ApiOperation({ summary: 'Get a shop order and shop-visible status history' })
  @ApiOkResponse({ type: ShopOrderDetailResponseDto })
  getOrder(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<ShopOrderDetailResponseDto> {
    return this.shopPortal.getOrder(user, id);
  }

  @Get('dashboard')
  @RequirePermissions('shop-portal.read')
  @ApiOperation({ summary: 'Get shop order counts, settlement totals, and daily status series' })
  @ApiOkResponse({ type: ShopDashboardResponseDto })
  getDashboard(@CurrentUser() user: AuthenticatedUser, @Query() query: ShopDashboardQueryDto): Promise<ShopDashboardResponseDto> {
    return this.shopPortal.getDashboard(user, query);
  }

  @Get('statement')
  @RequirePermissions('shop-portal.read')
  @ApiOperation({ summary: 'Get the authenticated shop’s statement' })
  @ApiOkResponse({ type: ShopStatementResponseDto })
  getStatement(@CurrentUser() user: AuthenticatedUser, @Query() query: ShopStatementQueryDto): Promise<ShopStatementResponseDto> {
    return this.shopPortal.getStatement(user, query);
  }

  @Get('statement/export')
  @RequirePermissions('shop-reports.export')
  @ApiOperation({ summary: 'Export the authenticated shop’s statement as CSV or XLSX' })
  @ApiProduces(CSV_CONTENT_TYPE, XLSX_CONTENT_TYPE)
  @ApiOkResponse({ description: 'Shop-safe statement file attachment', schema: { type: 'string', format: 'binary' } })
  async exportStatement(@CurrentUser() user: AuthenticatedUser, @Query() query: ShopStatementExportQueryDto, @Res() response: Response): Promise<void> {
    const statement = await this.shopPortal.getStatementForExport(user, query);
    const headers = [
      'shopName', 'dateFrom', 'dateTo', 'dateBasis', 'receivedCount', 'outForDeliveryCount',
      'deliveredCount', 'cancelledCount', 'priceTotal', 'feeTotal',
      'codCollected', 'codExpected', 'netOwedToShopDelivered', 'pendingNetOwedToShop', 'netOwedToShopTotal',
    ];
    const row: ExportRow = [
      statement.shopName, statement.dateFrom, statement.dateTo, statement.dateBasis,
      statement.receivedCount, statement.outForDeliveryCount, statement.deliveredCount,
      statement.cancelledCount, statement.priceTotal, statement.feeTotal,
      statement.codCollected, statement.codExpected, statement.netOwedToShopDelivered,
      statement.pendingNetOwedToShop, statement.netOwedToShopTotal,
    ];
    sendExport(response, query.format, 'shop-statement', statement.dateFrom, statement.dateTo, headers, [row]);
  }
}
