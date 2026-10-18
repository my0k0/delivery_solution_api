import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { OrderStatus } from '../../orders/order.schema.js';

export class ReportPaginationDto {
  @ApiProperty() page!: number;
  @ApiProperty() perPage!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}

export class OrderReportRowDto {
  @ApiProperty() id!: string;
  @ApiProperty() trackingCode!: string;
  @ApiProperty() shopId!: string;
  @ApiProperty() shopName!: string;
  @ApiProperty() customerName!: string;
  @ApiPropertyOptional({ nullable: true }) customerPhone!: string | null;
  @ApiPropertyOptional({ nullable: true }) deliveryAddress!: string | null;
  @ApiPropertyOptional({ nullable: true }) townshipId!: string | null;
  @ApiPropertyOptional({ nullable: true }) townshipName!: string | null;
  @ApiProperty({ enum: ['PENDING', 'ASSIGNED', 'AWAITING_APPROVAL', 'DELIVERED', 'CANCELLED'] }) status!: OrderStatus;
  @ApiPropertyOptional({ enum: ['RIDER', 'PARTNER'], nullable: true }) assigneeType!: 'RIDER' | 'PARTNER' | null;
  @ApiPropertyOptional({ nullable: true }) assigneeId!: string | null;
  @ApiPropertyOptional({ nullable: true }) assigneeName!: string | null;
  @ApiProperty() packagePrice!: string;
  @ApiProperty() deliveryFee!: string;
  @ApiProperty() codToCollect!: string;
  @ApiProperty() netOwedToShop!: string;
  @ApiProperty() shopAdvanceAmount!: string;
  @ApiProperty() partnerFee!: string;
  @ApiProperty() createdAt!: string;
  @ApiPropertyOptional({ nullable: true }) deliveredAt!: string | null;
}

export class OrderReportTotalsDto {
  @ApiProperty() orderCount!: number;
  @ApiProperty() packagePrice!: string;
  @ApiProperty() deliveryFee!: string;
  @ApiProperty() codToCollect!: string;
  @ApiProperty() netOwedToShop!: string;
  @ApiProperty() shopAdvanceAmount!: string;
  @ApiProperty() partnerFee!: string;
}

export class OrderReportResponseDto {
  @ApiProperty({ type: [OrderReportRowDto] }) data!: OrderReportRowDto[];
  @ApiProperty({ type: ReportPaginationDto }) meta!: ReportPaginationDto;
  @ApiProperty({ type: OrderReportTotalsDto }) totals!: OrderReportTotalsDto;
}

export class OfficeShopStatementResponseDto {
  @ApiProperty() shopId!: string;
  @ApiProperty() shopName!: string;
  @ApiProperty() dateFrom!: string;
  @ApiProperty() dateTo!: string;
  @ApiProperty() dateBasis!: string;
  @ApiProperty() pendingCount!: number;
  @ApiProperty() assignedCount!: number;
  @ApiProperty() awaitingApprovalCount!: number;
  @ApiProperty() deliveredCount!: number;
  @ApiProperty() cancelledCount!: number;
  @ApiProperty() priceTotal!: string;
  @ApiProperty() feeTotal!: string;
  @ApiProperty() codCollected!: string;
  @ApiProperty() codExpected!: string;
  @ApiProperty() netOwedToShopDelivered!: string;
  @ApiProperty() pendingNetOwedToShop!: string;
  @ApiProperty({
    description:
      'Flow: advances paid to this shop during the selected period, bucketed by the advance date',
  })
  advancedToShop!: string;
}

export class RiderCollectionRowDto {
  @ApiProperty() riderId!: string;
  @ApiProperty() riderName!: string;
  @ApiProperty() date!: string;
  @ApiProperty() deliveredOrderCount!: number;
  @ApiProperty() awaitingApprovalOrderCount!: number;
  @ApiProperty() expectedCodToHandBack!: string;
  @ApiProperty() awaitingApprovalCod!: string;
}

export class RiderCollectionTotalsDto {
  @ApiProperty() deliveredOrderCount!: number;
  @ApiProperty() awaitingApprovalOrderCount!: number;
  @ApiProperty() expectedCodToHandBack!: string;
  @ApiProperty() awaitingApprovalCod!: string;
}

export class RiderCollectionResponseDto {
  @ApiProperty({ type: [RiderCollectionRowDto] }) data!: RiderCollectionRowDto[];
  @ApiProperty({ type: RiderCollectionTotalsDto }) totals!: RiderCollectionTotalsDto;
}

export class RiderPayoutRowDto {
  @ApiProperty() riderId!: string;
  @ApiProperty() riderName!: string;
  @ApiProperty() deliveredOrderCount!: number;
  @ApiProperty() earnedAmount!: string;
  @ApiProperty() pendingApprovalOrderCount!: number;
  @ApiProperty() pendingApprovalAmount!: string;
}

export class RiderPayoutTotalsDto {
  @ApiProperty() deliveredOrderCount!: number;
  @ApiProperty() earnedAmount!: string;
  @ApiProperty() pendingApprovalOrderCount!: number;
  @ApiProperty() pendingApprovalAmount!: string;
}

export class RiderPayoutResponseDto {
  @ApiProperty({ type: [RiderPayoutRowDto] }) data!: RiderPayoutRowDto[];
  @ApiProperty({ type: RiderPayoutTotalsDto }) totals!: RiderPayoutTotalsDto;
}

export class DashboardKpiDto {
  @ApiProperty() key!: string;
  @ApiProperty() count!: number;
  @ApiProperty() amount!: string;
}

export class OrdersPerDayStatusDto {
  @ApiProperty() date!: string;
  @ApiProperty({ enum: ['PENDING', 'ASSIGNED', 'AWAITING_APPROVAL', 'DELIVERED', 'CANCELLED'] }) status!: OrderStatus;
  @ApiProperty() orderCount!: number;
}

export class FinancialDayDto {
  @ApiProperty() date!: string;
  @ApiProperty() feeIncome!: string;
  @ApiProperty() partnerCost!: string;
  @ApiProperty() commissionEarned!: string;
  @ApiProperty() margin!: string;
}

export class TopShopDto {
  @ApiProperty() shopId!: string;
  @ApiProperty() shopName!: string;
  @ApiProperty() orderCount!: number;
}

export class TownshipSuccessRateDto {
  @ApiProperty() townshipId!: string;
  @ApiProperty() townshipName!: string;
  @ApiProperty() deliveredCount!: number;
  @ApiProperty() cancelledCount!: number;
  @ApiProperty({ description: 'Percentage from 0 to 100, to two decimals' }) successRate!: string;
}

export class OrdersPerDayDto {
  @ApiProperty() date!: string;
  @ApiProperty() orderCount!: number;
}

export class OfficeDashboardResponseDto {
  @ApiProperty() today!: string;
  @ApiProperty({ type: [DashboardKpiDto] }) kpis!: DashboardKpiDto[];
  @ApiProperty({ type: [OrdersPerDayStatusDto] }) ordersPerDayByStatus!: OrdersPerDayStatusDto[];
  @ApiProperty({ type: [FinancialDayDto] }) feeIncomeVsPartnerCostVsCommission!: FinancialDayDto[];
  @ApiProperty({ type: [TopShopDto] }) topShops!: TopShopDto[];
  @ApiProperty({ type: [TownshipSuccessRateDto] }) townshipSuccessRates!: TownshipSuccessRateDto[];
  @ApiProperty() averagePendingAgeDays!: string;
}

export class RiderDashboardResponseDto {
  @ApiProperty() today!: string;
  @ApiProperty() todayDeliveredCount!: number;
  @ApiProperty() weekDeliveredCount!: number;
  @ApiProperty() monthDeliveredCount!: number;
  @ApiProperty() commissionEarned!: string;
  @ApiProperty() commissionPending!: string;
  @ApiProperty({ type: [OrdersPerDayDto] }) ordersPerDay!: OrdersPerDayDto[];
  @ApiProperty() codToHandBack!: string;
}
