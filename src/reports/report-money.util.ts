import { sql, type SQL } from 'drizzle-orm';
import type { orders } from '../orders/order.schema.js';

type OrderMoneyColumns = Pick<
  typeof orders,
  | 'packagePrice'
  | 'deliveryFee'
  | 'isPackagePaidToShop'
  | 'isFeePaidToShop'
  | 'shopAdvanceAmount'
>;

/** Canonical SQL expression for COD to collect; Postgres keeps all arithmetic numeric. */
export function codToCollectSql(columns: OrderMoneyColumns): SQL {
  return sql`(case when ${columns.isPackagePaidToShop} then 0::numeric else ${columns.packagePrice} end + case when ${columns.isFeePaidToShop} then 0::numeric else ${columns.deliveryFee} end)`;
}

/**
 * Canonical SQL expression for net owed to the shop; positive means the company
 * owes. An advance is money the company already paid that shop, so it reduces
 * what is still owed — with the column defaulting to `'0'`, every order without
 * an advance is arithmetically identical to the pre-advance formula.
 */
export function netOwedToShopSql(columns: OrderMoneyColumns): SQL {
  return sql`(case when ${columns.isPackagePaidToShop} then 0::numeric else ${columns.packagePrice} end - case when ${columns.isFeePaidToShop} then ${columns.deliveryFee} else 0::numeric end - ${columns.shopAdvanceAmount})`;
}

function decimalToCents(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error(`Invalid decimal money value '${value}'`);
  const sign = match[1] === '-' ? -1n : 1n;
  const whole = BigInt(match[2] ?? '0');
  const fraction = BigInt((match[3] ?? '').padEnd(2, '0'));
  return sign * (whole * 100n + fraction);
}

function centsToDecimal(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const absolute = cents < 0n ? -cents : cents;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

/**
 * Pure, bigint-backed counterpart used to verify the shared §4 formulas without
 * floats. `shopAdvanceAmount` defaults to the column default, so the
 * no-advance case must reproduce the pre-advance figures exactly.
 */
export function calculateOrderMoney(
  packagePrice: string,
  deliveryFee: string,
  isPackagePaidToShop: boolean,
  isFeePaidToShop: boolean,
  shopAdvanceAmount = '0',
): { codToCollect: string; netOwedToShop: string } {
  const packageCents = isPackagePaidToShop ? 0n : decimalToCents(packagePrice);
  const feeCents = decimalToCents(deliveryFee);
  const collectedFeeCents = isFeePaidToShop ? 0n : feeCents;
  const owedFeeCents = isFeePaidToShop ? feeCents : 0n;
  return {
    codToCollect: centsToDecimal(packageCents + collectedFeeCents),
    netOwedToShop: centsToDecimal(
      packageCents - owedFeeCents - decimalToCents(shopAdvanceAmount),
    ),
  };
}
