# Delivery Management API — Build Plan

This plan records the implemented API and the remaining gated work. All new work must preserve the fixed permission catalog, DTO-backed API contract, typed money handling, and the quality gate.

## Current status

- **Foundation:** complete
- **Phase 1 — Users/Auth/RBAC:** complete
- **Phase 2 — Master data:** complete
- **Phases 3, 4, and 5:** superseded by [`docs/delivery-workflow-v2.md`](docs/delivery-workflow-v2.md)
- **Workflow v2 phases A–E:** complete
- **Phase 6 — Returns/payment ledger/reconciliation:** blocked
- **Phase 7 — Notifications/Viber:** later
- **Phase 8 — Reports:** partially implemented in phases D/E; additional scope remains
- **Permission catalog:** 13 modules / 42 fixed keys, defined by `src/common/auth/permission-keys.ts`

## Implemented workflow v2 phases

- **A — Schema, state machine, permissions:** new order fields and history/audit tables, townships, delivery partners, commission defaults, revised order states, fixed permission catalog and SHOP role are implemented. The database reset/reseed workflow is available through `pnpm db:reset` and `pnpm db:seed`.
- **B — Office orders and approval:** order creation/edit/audit, assignment, postponement, cancellation, approval, send-back, and partner delivered operations are implemented, along with township and delivery-partner CRUD.
- **C — Commission:** per-order rider commission (prefilled from the township's required `defaultCommissionFee`, overridable per order) and rider delivery submission are implemented. The earlier per-way model, its settings, and pay-anyway recording were **removed on 2026-10-18**.
- **D — Reports and dashboards:** order, shop statement, rider collection, rider payout, office dashboard, and rider dashboard APIs are implemented; report exports support CSV/XLSX.
- **E — Shop portal:** shop-scoped orders, detail/history, dashboard, statement, and CSV/XLSX exports are implemented with dedicated shop DTOs.

The live API paths, shop display mapping, report definitions, and implementation differences are recorded in the workflow document's **As built** section.

## Phase 6 — Returns, payment ledger, and reconciliation — BLOCKED

Orders have a single terminal `CANCELLED` state, reached from `PENDING` or `ASSIGNED` with a required reason; cancelling covers both a called-off delivery and a package that came back to the shop. Whether the goods physically returned is deliberately not tracked, and there is no separate returns module or return-record workflow. COD and net owed to a shop are currently **derived** from `packagePrice`, `deliveryFee`, `isPackagePaidToShop`, and `isFeePaidToShop`; delivery/approval status determines whether an amount is expected or treated as collected. The legacy `orders.codAmount` column remains in the schema but is not read by application code.

There is **no payment ledger, no reconciliation model/process, no shop-prepayment record, and no cash-received record**. Reports are projections of order flags, statuses, and commission fields—not financial transaction history. Phase 6 remains blocked pending approved domain decisions and an ADR; do not infer ledger semantics from these projections.

## Phase 7 — Notifications and Viber — LATER

No notification feature module, notification permission keys, or schedule/send-log API is implemented. Scope and provider/scheduling decisions remain for a later phase.

## Phase 8 — Reports — PARTIALLY IMPLEMENTED

Already implemented through phases D/E:

- Office order report and CSV/XLSX export
- Office-level shop statement and export
- Rider collection and rider payout reports, each with CSV/XLSX export
- Office dashboard and rider dashboard
- Shop dashboard, statement, order list, and shop-safe exports

The earlier proposed daily, COD-pending, and performance-report endpoint list is not the current API contract. Any reports beyond the implemented set need to be scoped and verified against the live report services and DTOs before planning.

## Working rules

- Run `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm test` for local changes. E2E uses the real Compose Postgres database; run `pnpm test:e2e` only when that database is disposable or safe for test writes.
- Generate migrations with `pnpm db:generate`; new schema tables must be re-exported from `src/common/database/schema.ts`.
- New protected routes use an existing fixed key from `permission-keys.ts`; catalog changes require a code change and reseeding.
- Preserve decimal strings/SQL `numeric` for money and use `APP_TIMEZONE` for business-day boundaries.
- Shop data stays scoped to the authenticated user's `shopId`; use dedicated shop response DTOs and the shared export formula-injection guard.
