# Delivery Workflow v2 — Approved Requirement Change

**Status:** IMPLEMENTED (phases A–E complete; Phase F documentation updated). **Revised 2026-10-18:** the per-**way** commission model was replaced by per-**order** rider commission (§5), and the permission catalog is now **13 modules / 42 keys** (§6).

Repos: `delivery_solution_api` (NestJS 12, Drizzle, Postgres 18) and `delivery_solution_frontend` (Vite + React + TS). Follow each repo's `CLAUDE.md`: no `any`, no abbreviations, ESM `.js` import suffixes, kebab-case typed file names, DTOs for all request/response shapes with `@Api*Response({ type })`, one responsibility per dialog/form file on the frontend, `pnpm codegen` for frontend API types (API must be running), **no new test files in the frontend**.

## 1. Business context

Myanmar delivery company. Flow: shop → delivery company → customer (customer orders from the shop). Packages are collected outside the system; office staff enter orders after the packages reach the office. The company prepays shops about 5–7 days of packages before delivery/COD, so reconciliation matters. Some orders go to another delivery company (a **partner**) instead of an own rider.

Real voucher patterns: price + fee to collect (47,000 + 3,500 = 50,500); "COD 18,000, delivery already paid"; "95,000 + deli".

**Open gap — the prepayment itself is still not modelled.** The company→shop advance described above, and the reclaim of that advance when a package comes back to the shop, have no representation in the schema or the API. Designed but **not built**: see `delivery_solution_frontend/docs/business-flows.md` and `delivery_solution_frontend/docs/superpowers/specs/2026-10-18-shop-advance-and-returns-design.md`. Phase 6 stays blocked; the design respects that.

## 2. Final decisions

1. **Shop portal:** shop users log in (`users.shop_id`, one login per shop, one shop per user) and see only their own orders. Filters: date range (default today) with a **date basis selector** (entry date default, or delivered date), status, datetime. Search by customer name, phone, etc. Columns: package price, delivery fee, total, status, delivered datetime, estimated date.
2. **Delivered datetime** = when the rider taps delivered (not approval time). For partner orders it is the officer's mark-delivered time.
3. **Approval:** rider marks delivered → status `AWAITING_APPROVAL` → officer approves (`DELIVERED`) or **Send back** (returns to `ASSIGNED`, shop-visible reason + internal note). Approval keys belong to the officer role.
4. **Cancel** = order is dead (`CANCELLED`), whether the delivery was called off or the package came back to the shop — one terminal state, no separate returned state. Anyone with `orders.cancel` (order-create role) can cancel. Send back = approval rejection.
5. **Rider** has only "submit delivered". No reject/fail button.
6. **Failure/postponement:** only an officer decides, with a reason visible to the shop. Order may be re-assigned to the same rider, another rider, or nobody (goes to `PENDING`).
7. **Statuses:** `PENDING` (no assignee), `ASSIGNED`, `AWAITING_APPROVAL`, `DELIVERED`, `CANCELLED`. Clearing the assignee returns to `PENDING`. All state changes are kept in history.
8. **Editable order:** all fields (township, shop, customer, address, notes, price, delivery fee, assignee including blank, etc.), every edit audited field-by-field.
9. **No round-robin.** One default rider-or-partner per township; one rider may cover many townships. Order create prefills the township default assignee; manual override allowed.
10. **Township** has `defaultDeliveryFee` (prefilled, overridable) and `leadTimeDays`, and — since 2026-10-18 — a required `defaultCommissionFee` (§5).
11. **Estimated delivery date** shown to shops.
12. **Shops never see rider info or partner name.** Partner charge is an internal cost field.
13. **Payment state** (customer already paid the shop): two flags `isPackagePaidToShop`, `isFeePaidToShop` (covers both / price only / fee only / nothing). Partial amounts are out of scope (add `amountPaidToShop` later if needed). These flags are **customer-side only** — they say what the customer paid the shop, and they drive COD. They say nothing about what the company pays the shop; see §1.
14. **Rider commission — revised 2026-10-18:** per **order**, not per way. `orders.commissionFee` is prefilled from the township's required `defaultCommissionFee` (seed 500.00) and may be overridden per order by an officer. The `ways` module, the `commissionPerWay` setting, the per-rider override, and the pay-anyway flow were all **removed**.
15. **Commission is earned per order — revised 2026-10-18:** an order's commission is *pending* while `AWAITING_APPROVAL` and *earned* once it reaches `DELIVERED` through the approval queue. A cancelled or never-delivered order earns nothing, and a partner order never carries a commission at all.
16. **Shop dashboard** + shop report export. 17. **Rider dashboard** with commission report.
18. **Pickups are removed.** The `pickups` module, its tables, `PICKED_UP`, `RECEIVED_AT_OFFICE`, permission keys `pickups.*`, and frontend `PickupsPage` are deleted.
19. **`delivery_attempts` + `delivery_attempt_history` are retired.** Order history (extended) and the order's assignee replace them. The 3-attempt cap is dropped.
20. **Pay anyway — removed 2026-10-18.** The per-way pay-anyway flow and the `ways.override_commission` key were deleted along with the `ways` module (§5).
21. Dev data is disposable: reset the DB (`pnpm db:reset`) and generate clean migrations; no status-mapping migration needed. No production data exists.
22. Phase 6 (payment ledger, reconciliation, prepayments to shops) stays **blocked**. Everything here is plain fields or read-only reporting derived from order fields.

## 3. Data model (API)

New tables (all with `id uuid default gen_random_uuid()`, `created_at`/`updated_at` timestamptz; re-export every table from `src/common/database/schema.ts`):

- `townships`: `name` (unique), `defaultDeliveryFee numeric(12,2)`, `defaultCommissionFee numeric(12,2)`, `leadTimeDays int`, `defaultAssigneeType` (`RIDER`|`PARTNER`|null), `defaultRiderId`, `defaultPartnerId`. Check constraint: assignee columns consistent with type.
- `delivery_partners`: `name` (unique), `phone`, `note`, `isActive`.
- ~~`ways`~~ — **removed 2026-10-18**; rider commission is per order (§5).
- `order_field_audit`: `orderId`, `field`, `oldValue`, `newValue`, `actorId`, `reason`, `createdAt`.
- `app_settings`: key/value. (`commissionPerWay` was **removed 2026-10-18**, as was `riders.commissionPerWayOverride`.)

Extend `orders`: `townshipId`, `assigneeType` (`RIDER`|`PARTNER`|null), `riderId`, `partnerId`, `partnerTrackingNo`, `packagePrice`, `deliveryFee` (snapshot of township fee at creation, overridable), `commissionFee` (snapshot of township commission at creation, overridable), `isPackagePaidToShop`, `isFeePaidToShop`, `partnerFee` (internal), `estimatedDeliveryDate`, `deliveredAt`, `deliveryAddress`, `cancelReason`. Deprecate `codAmount` (keep column, stop using; COD is derived). Add index on `deliveredAt`, `townshipId`, `riderId`.

Extend `order_status_history`: `reason` (shop-visible), `internalNote`, `previousAssignee`/`newAssignee` (typed jsonb or columns).

Extend `users`: nullable `shopId` FK. New seeded role `SHOP`.

State machine (`OrderStateService`, hard-coded matrix, exhaustive unit tests):

```
PENDING            → ASSIGNED, CANCELLED
ASSIGNED           → PENDING (clear assignee / postpone), ASSIGNED (re-assign, history row), AWAITING_APPROVAL, CANCELLED
AWAITING_APPROVAL  → DELIVERED (approve), ASSIGNED (send back)
DELIVERED, CANCELLED → terminal
```

Partner orders: officer marks delivered directly `ASSIGNED → DELIVERED` (acts as approval, sets `deliveredAt`). Partner orders never carry a rider commission — the API forces `commissionFee` to `'0'` whenever the effective assignee type is `PARTNER`.

## 4. Money rules

Decimal strings / SQL `numeric`, never JS floats. P = `packagePrice`, F = `deliveryFee`.

- COD to collect = (package paid ? 0 : P) + (fee paid ? 0 : F)
- Net owed to shop = (package paid ? 0 : P) − (fee paid ? F : 0). Positive = company owes shop; negative = shop owes company.
- Company fee income = F. Margin = F − partnerFee − rider commission.
- Money counts as received only after approval (`DELIVERED`).
- Estimated date = order date (or `availableFrom`) + township `leadTimeDays`; overridable and audited; derived "Delayed" badge.
- Editing money fields requires `orders.update`; editing them after approval requires `orders.update_after_approval` and a reason. (`orders.update_costs` was **removed 2026-10-18**; money editing folded into `orders.update`.)

## 5. Commission (revised 2026-10-18 — was "Ways and commission")

- Rider commission is **per order**, snapshotted on `orders.commissionFee`. It is prefilled at creation from the township's required `defaultCommissionFee` and may be overridden per order — the override is an ordinary money-field edit.
- The former **way** grouping is gone: no `ways` table, no `wayDate`, no auto-join on assignment, no derived way state, no `commissionPerWay` setting, no per-rider override.
- An order's commission is **pending** while `AWAITING_APPROVAL` and **earned** once it reaches `DELIVERED` through the approval queue. A cancelled or never-delivered order earns nothing.
- **Partner orders never carry a commission** — the API forces `commissionFee` to `'0'` when the effective assignee type is `PARTNER`.
- An order with no township is legitimate and carries commission `'0'`.
- **Pay anyway is removed**, along with `ways.override_commission`. Post-approval money edits (including `commissionFee`) remain reason-required and audited under `orders.update_after_approval`.
- No custody sign-out/return flow, and no "5 of 10" rule.

## 6. Permissions (catalog grows beyond 68; update `MODULE_ACTIONS`, seed, docs, frontend `src/types/permission.ts`)

New/changed keys: `deliveries.approve`, `orders.cancel`, `orders.update_after_approval`, `shop-portal.read`, `shop-reports.export`; add modules `townships`, `partners`; remove `pickups.*`. Riders must still not receive `orders.read`. The SHOP role gets only `shop-portal.read` and `shop-reports.export`. Update OFFICER/RIDER/SHOP seed mappings. (`orders.update_costs`, `ways.override_commission`, and the whole `ways` module were **removed 2026-10-18**.)

As built, the catalog is **13 modules / 42 keys**. The `returns`, `payments`, and `notifications` modules were removed entirely, then every key with no endpoint behind it (`*.import`, the per-module `*.export`, and the route-less `orders.delete` / `deliveries.create` / `deliveries.delete`), and finally the `ways` module together with `orders.update_costs` when the per-way commission model was replaced by per-order commission — so the catalog no longer reserves keys for unimplemented areas.

## 7. APIs

- Office: `POST /orders` (`riderId` set = manual, `null` = pending, omitted = township default; a township without assignee does not block creation), `PATCH /orders/:id` (audited edit; changing township asks the client to confirm before overwriting fee/assignee defaults), `POST /orders/:id/cancel`, `/orders/:id/assign`, `/orders/:id/postpone`, `/orders/:id/approve`, `/orders/:id/send-back`, `/orders/:id/mark-delivered` (partner), `GET /orders/:id/audit`, townships/partners CRUD.
- Rider: board of own assigned orders (computed COD, 0 for fully prepaid), `POST /riders/me/orders/:id/delivered`. No fee/margin/partner/shop finance fields.
- Shop: `GET /shop/orders`, `GET /shop/orders/:id`, `GET /shop/dashboard`, `GET /shop/statement` (+CSV/XLSX export). **Dedicated `ShopOrderResponseDto`**: no rider, partner, cost, internal-note or audit fields; shop-relevant history only; `AWAITING_APPROVAL` is mapped to "Out for delivery" in the DTO builder. Never hide fields conditionally on a shared DTO.
- Reports (read-only, derived): shop statement, order report (filters: date, shop, township, status, assignee; totals row; CSV), rider collection (per rider per day, expected COD to hand back), rider payout (per rider: delivered-order count, earned vs pending commission), office dashboard, shop dashboard, rider dashboard.

## 8. Phases (stop for review after each)

- **A — Schema, state machine, permissions (API):** remove pickups + delivery attempts, new tables/columns, new matrix + unit tests, permission catalog + seed + SHOP role, `users.shop_id`, `pnpm db:reset`, full gate.
- **B — Office orders + approval:** order create/edit/audit/cancel/assign/postpone/approve/send-back API; frontend order form (township prefill, overwrite prompt), approval queue, audit view, townships/partners screens; `pnpm codegen`.
- **C — Commission:** per-order rider commission and the township default (§5), rider board "submit delivered". The per-way model, its settings, and pay-anyway originally shipped in this phase and were **removed 2026-10-18**.
- **D — Reports + dashboards:** endpoints, CSV/XLSX export, office/rider dashboards (`dataviz` skill before the first chart).
- **E — Shop portal:** shop endpoints + dedicated DTO, separate frontend route tree/layout, shop dashboard and exports.
- **F — Docs:** update `README.md`, `PLAN.md`, `AGENTS.md`, `CLAUDE.md` in the API; `CLAUDE.md` (and README) in the frontend; fix the permission key count; memory notes.

Gate after every phase — API: `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm test:e2e`. Frontend: `pnpm lint`, `pnpm build`, manual smoke against the API.

## 9. Conventions and risks

- Skills: `ui-ux-pro-max` for UI, `dataviz` for charts, `taste` for polish.
- Enum changes in Postgres are not transactional: regenerate migrations after reset; never hand-edit generated SQL or delete `drizzle/meta/*`.
- Race conditions: state transitions (guarded by expected current status, as in `applyTransitionInTransaction`). The former way auto-join race no longer exists.
- Privacy: shop endpoints must be scoped by `users.shop_id` server-side, never by client-supplied shop id.
- Out of scope: Phase 6 ledger/reconciliation, prepayments to shops, partial customer payments, notifications.

## As built

The following paths are under `/api/v1`.

### Implemented endpoints

- **Office orders:** `GET/POST /orders`; `GET /orders/:id`; `PATCH /orders/:id`; `GET /orders/:id/history`; `GET /orders/:id/audit`; `POST /orders/:id/assign`; `POST /orders/:id/postpone`; `POST /orders/:id/cancel`; `POST /orders/:id/approve`; `POST /orders/:id/send-back`; `POST /orders/:id/mark-delivered` (partner orders).
- **Reference data:** township CRUD at `/townships`; delivery-partner CRUD at `/delivery-partners` (permission namespace `partners`).
- **Commission:** there is no commission endpoint. `orders.commissionFee` is read from the order and edited through `PATCH /orders/:id` (after approval, with a reason).
- **Rider:** `GET /riders/me/orders`; `POST /riders/me/orders/:id/delivered`; `GET /riders/me/dashboard`.
- **Reports:** `GET /reports/orders` and `/reports/orders/export`; `/reports/shop-statement` and `/reports/shop-statement/export`; `/reports/rider-collection` and `/reports/rider-collection/export`; `/reports/rider-payout` and `/reports/rider-payout/export`; `GET /reports/office-dashboard`.
- **Shop portal:** `GET /shop/orders`; `GET /shop/orders/export`; `GET /shop/orders/:id`; `GET /shop/dashboard`; `GET /shop/statement`; `GET /shop/statement/export`.

Exports accept CSV or XLSX and use the shared spreadsheet formula-injection guard. The API contract and DTO shapes are generated from the running API's OpenAPI document.

### Shop display and attention behavior

The shop portal uses dedicated shop response DTOs and derives the shop scope only from the authenticated user's `shopId`. It never returns rider/partner identity, partner cost, internal notes, or audit fields.

Internal order states map to shop display states as follows: `PENDING` → `RECEIVED`; `ASSIGNED` and `AWAITING_APPROVAL` → `OUT_FOR_DELIVERY`; `DELIVERED` → `DELIVERED`; `CANCELLED` → `CANCELLED`.

An order needs attention if it is still open (`PENDING`, `ASSIGNED`, or `AWAITING_APPROVAL`) and either its estimated delivery date is before today in `APP_TIMEZONE` or the latest postponement/send-back history entry has a non-empty reason. Closed delivered/cancelled orders do not receive the open-order attention flag.

### Settings and report definitions

The commission default lives on the township (`townships.defaultCommissionFee`, seed 500.00) and is snapshotted onto `orders.commissionFee` at creation. The former `GET/PUT /api/v1/ways/settings/commission-per-way` setting, backed by `app_settings.key = 'commissionPerWay'`, and the optional per-rider override, were **removed 2026-10-18**.

- **Date basis:** office order reports, shop statements, and shop portal date filters default to `ENTRY` (`orders.createdAt`); `DELIVERED` uses `orders.deliveredAt`. Date filters/grouping in these reporting paths use `APP_TIMEZONE`. Shop filters default to the current local date. (Rider payout is per rider and has no date-basis selector.)
- **Shop received count:** an internal `PENDING` order is displayed as `RECEIVED`. `ASSIGNED` and `AWAITING_APPROVAL` are displayed as `OUT_FOR_DELIVERY`.
- **COD collected:** only `DELIVERED` orders count as collected. **COD expected:** only open `PENDING`, `ASSIGNED`, and `AWAITING_APPROVAL` orders count as expected. COD/net-owed projections and office/shop statement payable totals exclude cancelled orders; shop order-list package-price, delivery-fee, and combined totals exclude `CANCELLED` orders. COD and net owed are calculated from package price, delivery fee, and the two payment-to-shop flags.
- **Rider collection:** rows are grouped by the local date of `deliveredAt` and include `DELIVERED` and `AWAITING_APPROVAL` orders. Approved-delivery COD is `expectedCodToHandBack`; awaiting-approval COD is reported separately.
- **Rider payout:** rows are per rider. An order's `commissionFee` counts as **earned** once the order is `DELIVERED` (bucketed by `deliveredAt`) and as **pending** while `AWAITING_APPROVAL` (bucketed by `createdAt`). Partner orders contribute nothing.
- **Other implemented reports:** the office dashboard provides order/status and finance series, shop ranking and township success rates; the shop dashboard provides local-date status counts and derived settlement summaries; the rider dashboard provides delivered counts, earned/pending commission, and today's delivered COD.

### Differences from this document's planned behavior

The implementation is authoritative where it differs from the plan:

1. The delivery-partner CRUD URL is `/delivery-partners`, while its permission module is `partners`.
2. Default role access is seeded in `scripts/seed.ts`. Role boundaries are grant-based, not enforced by hard-coded role-name checks: for example, postpone uses `orders.update`. OWNER and ADMIN have those grants by default, but ADMIN can grant catalog permissions to other roles; these operations are not intrinsically restricted to named roles.
3. The base `orders.codAmount` column remains in the schema, but application code does not read it; COD and net owed are derived from the order fields and flags.
4. `rider-collection` accepts the shared date-range DTO, including `dateBasis`, but the service always filters/groups by `deliveredAt`. `rider-payout` groups by rider and has no date-basis selector.
5. Some non-report order date handling is not yet aligned with the documented timezone convention: order-list `dateFrom`/`dateTo` bounds are built as UTC timestamps, and the default estimated delivery date starts from the current UTC calendar date. Report and shop portal date boundaries use `APP_TIMEZONE`.
6. The proposed standalone `/reports/daily`, `/reports/cod-pending`, `/reports/rider-performance`, and `/reports/shop-performance` endpoints are not present. The live report set is the endpoint list above.
7. The former per-way model also had an `EMPTY` derived state when a way contained no orders. That state went with the module and no longer exists.
8. `drizzle/0018_merge-cancel-return.sql` is a data-mapping migration. Decision 21 assumed dev data was disposable and that no status mapping would be needed, but `RETURNED` was later folded into the single terminal `CANCELLED` state, so the migration rewrites existing `RETURNED` rows in `orders.status` and in `order_status_history.from_status`/`to_status` before rebuilding the `order_status` enum type. `RETURNED` no longer exists in the enum, the transition matrix, the shop display vocabulary, or the report DTOs; `returnedCount` was removed from the shop statement rather than kept as an always-zero column.
