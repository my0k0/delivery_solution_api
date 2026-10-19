# Delivery Management System — Backend API

NestJS 12 + TypeScript API for a single delivery company's operations. It manages shops, customers, riders, delivery partners, townships, orders, rider commission, shop access, and operational reports. The current order workflow and implemented scope are documented in [`docs/delivery-workflow-v2.md`](docs/delivery-workflow-v2.md).

## Current status

- **Foundation:** complete
- **Phase 1 — Users, Auth, RBAC:** complete
- **Phases 2–5:** superseded by workflow v2 phases A–E; **A–E are complete**
- **Phase 6 — Returns/payment ledger/reconciliation:** blocked. COD and net owed are derived from order prices and payment-to-shop flags; there is no payment ledger, reconciliation, shop prepayment, or cash-received record.
- **Phase 7 — Notifications/Viber:** later
- **Phase 8 — Reports:** partially delivered in phases D/E; see below for the live reports and exports

## Stack and requirements

- Node.js 22.12+, pnpm 9+, Docker Compose
- NestJS 12 (Express), TypeScript, PostgreSQL 18, Drizzle ORM
- Redis 8 is provisioned for future jobs; Swagger/OpenAPI and Vitest

## Setup

```bash
pnpm install
# Copy .env.example to .env and configure DATABASE_URL and JWT_SECRET.
docker compose up -d
pnpm db:seed
pnpm db:seed:demo
pnpm start:dev
```

The API is at `http://localhost:3000/api/v1`; Swagger is at `/api/v1/docs`. Migrations run at application bootstrap. `APP_TIMEZONE` defaults to `Asia/Yangon`; set it to the operating timezone for business-day calculations. The Compose Postgres host port is controlled by `DB_PORT` (5432 by default).

`pnpm db:seed:demo` is for non-production development data. Demo login emails:

- Riders: `rider1@demo.delivery.local`, `rider2@demo.delivery.local`
- Shops: `shop1@demo.delivery.local`, `shop2@demo.delivery.local`, `shop3@demo.delivery.local`

## Common commands

```bash
pnpm start:dev
pnpm typecheck
pnpm lint
pnpm build
pnpm test
pnpm test:e2e
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm db:seed:demo
pnpm db:studio
pnpm db:reset       # destructive: drop schema/data, migrate, then base seed
```

`db:reset` uses `docker compose exec` against the `postgres` service and then runs migrations and the base seed. It does not add demo records; run `pnpm db:seed:demo` separately if wanted. E2E tests use the Compose Postgres database and write temporary data; do not run them against a database you care about.

Quality gate:

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm test
pnpm test:e2e
```

## Authentication and permissions

All routes except public routes require a JWT access token from `POST /api/v1/auth/login`. Global guards authenticate the active user and check route permissions. The permission catalog is fixed in `src/common/auth/permission-keys.ts`: **14 modules / 46 keys**. The modules are `users`, `roles`, `permissions`, `shops`, `customers`, `riders`, `orders`, `deliveries`, `townships`, `partners`, `shop-portal`, `shop-reports`, `reports`, and `rider-handovers`. Keys are seeded; runtime APIs can read the catalog and replace role grants, but cannot create or delete permission keys.

Seeded roles are `OWNER` (system role, all catalog permissions), `ADMIN` (all catalog permissions), `OFFICER` (order operations, delivery approval, township/partner/way operations, and reports), `RIDER` (own delivery read/update), and `SHOP` (shop portal read and shop report export). The exact seed grants are in `scripts/seed.ts`.

## Order workflow

The real order states are `PENDING`, `ASSIGNED`, `AWAITING_APPROVAL`, `DELIVERED`, and `CANCELLED`.

- New orders carry an optional explicit rider or delivery partner and otherwise remain `PENDING`; a township never supplies an assignee. Office staff can assign or reassign a rider or delivery partner.
- Riders can submit an assigned order as delivered. It becomes `AWAITING_APPROVAL`; an officer approves it to `DELIVERED` or sends it back to `ASSIGNED` with a shop-visible reason and optional internal note.
- An officer can mark a partner order delivered directly. A partner order never carries a rider commission: the API forces `commissionFee` to `0`.
- Officers can postpone an order (clear assignee to `PENDING`) or cancel it from `PENDING` or `ASSIGNED` with a required reason — cancelling covers both a called-off delivery and a package that came back to the shop. `DELIVERED` and `CANCELLED` are terminal, and a terminal order cannot be edited.
- Order edits are audited field-by-field and require `orders.update`. An order that has ended (`DELIVERED`, `CANCELLED`) cannot be edited at all, so there are no post-approval money edits; the shop advance on a delivered order still needs `orders.update_after_approval` and a reason.

### Ways, commission, and order money

Rider commission is per order. `orders.commissionFee` is prefilled from the township's required `defaultCommissionFee` (seed 500 MMK) and can be overridden per order; a partner order's commission is always `0`, and an order with no township carries `0`. An order's commission is **earned** once the order is approved as delivered (`DELIVERED`) and **pending** while it awaits approval. The earlier per-way model — ways, the `commissionPerWay` setting, per-rider overrides, and the **Pay anyway** flow (`ways.override_commission`) — was removed on 2026-10-18.

Money is stored as SQL `numeric` and returned as decimal strings. COD to collect and net owed to the shop are derived from `packagePrice`, `deliveryFee`, `isPackagePaidToShop`, and `isFeePaidToShop`. COD is counted as collected only once an order is `DELIVERED` (including approved rider deliveries); open orders contribute to expected COD. These are projections, not a cash-received ledger.

## Shop portal

Shop users can see only orders for the shop linked to their authenticated user record. The API uses dedicated shop DTOs and excludes rider/partner identity, internal notes, and audit details. Shops can filter orders by entry or delivered date, local time, display status, attention flag, and customer/tracking search; default date range is today in `APP_TIMEZONE`.

Shop-facing statuses map as follows: `PENDING` → `RECEIVED`; `ASSIGNED` and `AWAITING_APPROVAL` → `OUT_FOR_DELIVERY`; `DELIVERED` and `CANCELLED` retain their names. An order needs attention when it is still open and its estimate is past or its latest postponement/send-back has a reason.

## Reports and exports

Implemented office reports: order report, shop statement, rider collection, rider payout, and office dashboard. The rider dashboard includes way and commission summaries; the shop dashboard and statement are available in the shop portal. Order reports and shop orders/statements support CSV and XLSX exports. Spreadsheet text is passed through the formula-injection guard in `src/reports/report-export.util.ts`.

Date-range reports default to entry date (`createdAt`) unless a delivered-date basis is selected. Rider collection is grouped by local delivered date; rider payout uses the way's local business date. `APP_TIMEZONE` defines report date boundaries. Report amounts are derived from order flags and statuses: delivered orders count toward collected COD; `PENDING`, `ASSIGNED`, and `AWAITING_APPROVAL` count toward expected COD. Cancelled orders do not contribute to COD/net-owed projections or office/shop statement payable totals. The shop order-list's raw package-price and fee totals still sum all filtered rows.

## Architecture

Feature modules registered in `src/app.module.ts`: `auth`, `users`, `roles`, `permissions`, `shops`, `customers`, `riders`, `orders`, `townships`, `delivery-partners` (permission module `partners`), `reports`, and `shop-portal`. Shared infrastructure is under `src/common/` (database, auth, health, utilities); configuration is under `src/config/`.

OpenAPI at `/api/v1/docs-json` is the canonical API contract.

## Roadmap

- [x] Foundation and Phase 1 (Users/Auth/RBAC)
- [x] Phases 2–5 replaced by workflow v2 phases A–E
- [x] Workflow v2 phases A–E: schema/state/RBAC, office orders and approval, per-order commission, reports/dashboards, shop portal
- [ ] Phase 6: returns workflow, payment ledger, shop prepayments, cash-received recording, and reconciliation (blocked)
- [ ] Phase 7: notifications and Viber
- [ ] Phase 8: additional reports beyond the order, shop, rider, and dashboard reporting already delivered
