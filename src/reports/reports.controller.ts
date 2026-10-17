import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RequirePermissions } from '../common/auth/permissions.decorator.js';
import { ReportsService } from './reports.service.js';
import {
  OrderReportExportQueryDto,
  OrderReportQueryDto,
  RiderReportExportQueryDto,
  RiderReportQueryDto,
  ShopStatementExportQueryDto,
  ShopStatementQueryDto,
  DateRangeQueryDto,
} from './dto/report-query.dto.js';
import {
  OfficeDashboardResponseDto,
  OrderReportResponseDto,
  RiderCollectionResponseDto,
  RiderPayoutResponseDto,
  ShopStatementResponseDto,
} from './dto/report-response.dto.js';
import { renderCsv, renderXlsx, reportFilename, type ExportRow } from './report-export.util.js';

const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function sendExport(
  response: Response,
  format: 'csv' | 'xlsx',
  reportName: string,
  dateFrom: string,
  dateTo: string,
  headers: readonly string[],
  rows: readonly ExportRow[],
): void {
  const content = format === 'csv' ? renderCsv(headers, rows) : renderXlsx(headers, rows);
  response.setHeader('Content-Type', format === 'csv' ? CSV_CONTENT_TYPE : XLSX_CONTENT_TYPE);
  response.setHeader('Content-Disposition', `attachment; filename="${reportFilename(reportName, dateFrom, dateTo, format)}"`);
  response.status(200).end(content);
}

@ApiTags('Reports')
@ApiBearerAuth('access-token')
@Controller({ path: 'reports', version: '1' })
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('orders')
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'List office orders with filtered totals' })
  @ApiOkResponse({ type: OrderReportResponseDto })
  getOrders(@Query() query: OrderReportQueryDto): Promise<OrderReportResponseDto> {
    return this.reports.getOrders(query);
  }

  @Get('orders/export')
  @RequirePermissions('reports.export')
  @ApiOperation({ summary: 'Export office order report as CSV or XLSX' })
  @ApiProduces(CSV_CONTENT_TYPE, XLSX_CONTENT_TYPE)
  @ApiOkResponse({ description: 'Report file attachment', schema: { type: 'string', format: 'binary' } })
  async exportOrders(@Query() query: OrderReportExportQueryDto, @Res() response: Response): Promise<void> {
    const [rows, totals] = await Promise.all([
      this.reports.getAllOrdersForExport(query),
      this.reports.getOrderReportTotalsForExport(query),
    ]);
    sendExport(response, query.format, 'orders', query.dateFrom, query.dateTo,
      ['orderId', 'trackingCode', 'shopName', 'customerName', 'customerPhone', 'deliveryAddress', 'shopId', 'townshipId', 'townshipName', 'status', 'assigneeType', 'assigneeId', 'assigneeName', 'packagePrice', 'deliveryFee', 'codToCollect', 'netOwedToShop', 'partnerFee', 'createdAt', 'deliveredAt'],
      [
        ...rows.map((row): ExportRow => [row.id, row.trackingCode, row.shopName, row.customerName, row.customerPhone, row.deliveryAddress, row.shopId, row.townshipId, row.townshipName, row.status, row.assigneeType, row.assigneeId, row.assigneeName, row.packagePrice, row.deliveryFee, row.codToCollect, row.netOwedToShop, row.partnerFee, row.createdAt, row.deliveredAt]),
        ['TOTAL', '', '', '', '', '', '', '', '', '', '', '', '', totals.packagePrice, totals.deliveryFee, totals.codToCollect, totals.netOwedToShop, totals.partnerFee, '', ''],
      ]);
  }

  @Get('shop-statement')
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'Get office-level shop statement' })
  @ApiOkResponse({ type: ShopStatementResponseDto })
  getShopStatement(@Query() query: ShopStatementQueryDto): Promise<ShopStatementResponseDto> {
    return this.reports.getShopStatement(query.shopId, query);
  }

  @Get('shop-statement/export')
  @RequirePermissions('reports.export')
  @ApiOperation({ summary: 'Export shop statement as CSV or XLSX' })
  @ApiProduces(CSV_CONTENT_TYPE, XLSX_CONTENT_TYPE)
  @ApiOkResponse({ description: 'Report file attachment', schema: { type: 'string', format: 'binary' } })
  async exportShopStatement(@Query() query: ShopStatementExportQueryDto, @Res() response: Response): Promise<void> {
    const statement = await this.reports.getShopStatement(query.shopId, query);
    const headers = Object.keys(statement);
    const values = Object.values(statement).map((value) => value === null ? '' : String(value));
    sendExport(response, query.format, 'shop-statement', query.dateFrom, query.dateTo, headers,
      [values]);
  }

  @Get('rider-collection')
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'Get expected rider COD collections by local date' })
  @ApiOkResponse({ type: RiderCollectionResponseDto })
  getRiderCollection(@Query() query: RiderReportQueryDto): Promise<RiderCollectionResponseDto> {
    return this.reports.getRiderCollection(query);
  }

  @Get('rider-collection/export')
  @RequirePermissions('reports.export')
  @ApiOperation({ summary: 'Export rider collection report as CSV or XLSX' })
  @ApiProduces(CSV_CONTENT_TYPE, XLSX_CONTENT_TYPE)
  @ApiOkResponse({ description: 'Report file attachment', schema: { type: 'string', format: 'binary' } })
  async exportRiderCollection(@Query() query: RiderReportExportQueryDto, @Res() response: Response): Promise<void> {
    const report = await this.reports.getRiderCollection(query);
    sendExport(response, query.format, 'rider-collection', query.dateFrom, query.dateTo,
      ['riderId', 'riderName', 'date', 'deliveredOrderCount', 'awaitingApprovalOrderCount', 'expectedCodToHandBack', 'awaitingApprovalCod'],
      [
        ...report.data.map((row): ExportRow => [row.riderId, row.riderName, row.date, row.deliveredOrderCount, row.awaitingApprovalOrderCount, row.expectedCodToHandBack, row.awaitingApprovalCod]),
        ['', 'TOTAL', '', report.totals.deliveredOrderCount, report.totals.awaitingApprovalOrderCount, report.totals.expectedCodToHandBack, report.totals.awaitingApprovalCod],
      ]);
  }

  @Get('rider-payout')
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'Get rider payout by delivered order' })
  @ApiOkResponse({ type: RiderPayoutResponseDto })
  getRiderPayout(@Query() query: RiderReportQueryDto): Promise<RiderPayoutResponseDto> {
    return this.reports.getRiderPayout(query);
  }

  @Get('rider-payout/export')
  @RequirePermissions('reports.export')
  @ApiOperation({ summary: 'Export rider payout report as CSV or XLSX' })
  @ApiProduces(CSV_CONTENT_TYPE, XLSX_CONTENT_TYPE)
  @ApiOkResponse({ description: 'Report file attachment', schema: { type: 'string', format: 'binary' } })
  async exportRiderPayout(@Query() query: RiderReportExportQueryDto, @Res() response: Response): Promise<void> {
    const report = await this.reports.getRiderPayout(query);
    sendExport(response, query.format, 'rider-payout', query.dateFrom, query.dateTo,
      ['riderId', 'riderName', 'deliveredOrderCount', 'earnedAmount', 'pendingApprovalOrderCount', 'pendingApprovalAmount'],
      [
        ...report.data.map((row): ExportRow => [row.riderId, row.riderName, row.deliveredOrderCount, row.earnedAmount, row.pendingApprovalOrderCount, row.pendingApprovalAmount]),
        ['', 'TOTAL', report.totals.deliveredOrderCount, report.totals.earnedAmount, report.totals.pendingApprovalOrderCount, report.totals.pendingApprovalAmount],
      ]);
  }

  @Get('office-dashboard')
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'Get office KPI and chart data' })
  @ApiOkResponse({ type: OfficeDashboardResponseDto })
  getOfficeDashboard(@Query() query: DateRangeQueryDto): Promise<OfficeDashboardResponseDto> {
    return this.reports.getOfficeDashboard(query);
  }
}
