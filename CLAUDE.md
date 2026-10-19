# CLAUDE.md

Guidance for Claude Code and coding agents working in this repository.

## Project and phase status

NestJS 12 (Express) + TypeScript API for one delivery company's operations. PostgreSQL 18/Drizzle, Redis, Swagger, Vitest; single pnpm package using ESM under `nodenext`. Only commit or push when explicitly asked.

Foundation, Phase 1 (Users/Auth/RBAC), and Phase 2 (master data) are complete. Phases 3–5 are superseded by `docs/delivery-workflow-v2.md`; workflow v2 phases A–E are complete: schema/state/RBAC, office orders and approval, per-order commission, reports/dashboards, and shop portal. Phase 6 (returns/payment ledger/reconciliation) remains blocked; Phase 7 (notifications/Viber) is later; Phase 8 reports are partly delivered by phases D/E and need further scope for any additional slices. See `README.md`, `PLAN.md`, and the workflow document's As built section.

## Skills — invoke before task-specific code

| Task touches | Invoke |
|---|---|
| Any frontend/UI work | `ui-ux-pro-max` |
| Landing/marketing pages or aesthetic polish | `taste` on top of `ui-ux-pro-max` |
| Charts, graphs, KPI tiles, data visualization | `dataviz` before the first chart line |
| Logos, decks, icon sets, brand/social assets | `ui-ux-pro-max:design` |
| Library/framework/SDK/CLI docs question | Context7 (`ctx7` CLI per local rules) |
| Code review / quality pass on changes | `code-review` |

## Docs & memory sync

When a durable API, RBAC, schema, or convention change would mislead a fresh session, update `CLAUDE.md` and any `.claude/agents/*.md` that describe the affected behavior in the same change. Update persistent memory when the local project workflow requires it. Don't alter unrelated instructions.

## Type safety / code quality (mandatory)

- No `any`; type all request/response DTOs and explicit return types. Use `unknown` at trust boundaries.
- No `@ts-ignore`, `@ts-expect-error`, or bare non-null assertions to silence the compiler. Narrow unknown values with type guards.
- Keep strict TypeScript enabled and use `satisfies` for bounded const arrays.
- Drizzle rows use `.$inferSelect`/`.$inferInsert`; avoid bare `Record<string, unknown>` service responses.
- ESM `nodenext`: relative imports must end in `.js`.

## Naming conventions

- Prefer full words over abbreviations, except loop indexes and SQL aliases.
- Files use kebab-case with typed suffixes (`orders.service.ts`, `update-order.dto.ts`); tests use `*.spec.ts` or `*.e2e-spec.ts`.
- Classes/DTOs use PascalCase with a kind suffix; functions and methods use verb-first camelCase; variables are descriptive camelCase; constants are `UPPER_SNAKE_CASE`.
- Booleans use `is`/`has`/`can` prefixes. Types are singular PascalCase. Database tables/columns use snake_case and Drizzle properties use camelCase.

## Commands

```bash
pnpm install
# Copy .env.example to .env, then set DATABASE_URL and JWT_SECRET.
docker compose up -d
pnpm db:seed
pnpm db:seed:demo
pnpm start:dev
```

Quality gate:

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm test
pnpm test:e2e
```

Database scripts:

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed          # base catalog, roles, owner/admin accounts
pnpm db:seed:demo     # non-production demo fixtures
pnpm db:studio
pnpm db:reset         # destructive: Compose Postgres reset, migrations, base seed
```

`db:reset` uses `docker compose exec -T postgres`, drops the `public` and Drizzle bookkeeping schemas, then migrates and base-seeds. Demo fixtures are separate. E2E tests use the real Compose Postgres DB and write temporary data; never run them against a database you care about.

Demo login emails created by `pnpm db:seed:demo`: `rider1@demo.delivery.local`, `rider2@demo.delivery.local`, `shop1@demo.delivery.local`, `shop2@demo.delivery.local`, and `shop3@demo.delivery.local`.

## Environment

- `.env` is gitignored and may differ from `.env.example`; local Postgres commonly publishes on host port 5433 while the example uses 5432. Inspect before copying or overwriting it.
- `APP_TIMEZONE` defaults to `Asia/Yangon`; it defines business-day boundaries and report date grouping.
- App configuration is validated in `src/config/env.validation.ts` (`DATABASE_URL` and `JWT_SECRET` required); `drizzle.config.ts` loads env files itself. `.env.local` loads before `.env`.

## Architecture

- `src/main.ts` / `src/setup-app.ts`: `/api` prefix, URI version `v1`, validation pipe, CORS, Swagger. OpenAPI is generated at `/api/v1/docs-json` and is the canonical frontend contract.
- `src/app.module.ts` registers global guards in order: `JwtAuthGuard`, then `PermissionsGuard`.
- Shared code: `src/common/auth/`, `src/common/database/`, `src/common/health/`, `src/common/utils/`, and `src/config/`.
- Registered feature modules: `auth`, `users`, `roles`, `permissions`, `shops`, `customers`, `riders`, `orders`, `townships`, `delivery-partners`, `reports`, `shop-portal`, and `rider-handovers`. `delivery-partners` uses the permission module name `partners`.
- Feature schemas live with their module. Re-export every new table from `src/common/database/schema.ts`; that is the central schema entry used by Drizzle Kit.

## RBAC

The catalog in `src/common/auth/permission-keys.ts` is fixed and seeded: **14 modules / 46 keys**. Modules: `users`, `roles`, `permissions`, `shops`, `customers`, `riders`, `orders`, `deliveries`, `townships`, `partners`, `shop-portal`, `shop-reports`, `reports`, `rider-handovers`. The catalog has read-only API access; role grant sets are replaceable with `permissions.update`, but keys cannot be created/deleted at runtime. (`orders.shop_settlement` was added 2026-10-18 with the shop advance; the catalog was 42 keys before it.)

Seeded roles and grants from `scripts/seed.ts`:

- `OWNER`: `is_system=true`; effective grant is the entire catalog, with no grant rows required.
- `ADMIN`: all catalog keys.
- `OFFICER`: `orders.create/read/update/cancel/update_after_approval`; `deliveries.read/update/approve`; `townships.read/create/update/delete`; `partners.read/create/update/delete`; `reports.read/export`.
- `RIDER`: `deliveries.read`, `deliveries.update`.
- `SHOP`: `shop-portal.read`, `shop-reports.export`.

Every route requires a JWT unless `@Public()`. Protected routes need explicit `@RequirePermissions('module.action')`; unknown/non-granted permissions fail closed. Never expose `passwordHash`.

## Conventions

- `OrderStateService` owns all order state transitions and status-history writes. Order creation sets its initial status in the same transaction as `recordInitialStateInTransaction`; ordinary edits must not write status, and all subsequent transitions go through `OrderStateService`. A status with no transition out of it (`DELIVERED`, `CANCELLED`) has **ended**: `PATCH /orders/:id` refuses it with 409, and the check comes from `orderState.isTerminalStatus()` rather than a second hard-coded list. The shop advance is a settlement rather than an edit, so it stays available on a delivered order (requiring `orders.update_after_approval` and a reason).
- Money is SQL `numeric` and decimal strings at TypeScript/API boundaries; never use JavaScript floats for money.
- Business-day boundaries and date grouping always use `APP_TIMEZONE`.
- Shop-portal responses use dedicated DTOs. The shop scope always comes from the authenticated user's `shopId`, never a client-supplied shop id.
- CSV/XLSX exports use the formula-injection guard in `src/reports/report-export.util.ts`.
- Partner-assigned orders never carry a rider commission: the service forces `commissionFee = '0'` whenever the effective assignee is a partner, and preserves `orders_assignee_consistency_check` (assignee type, rider and partner must agree).
- Controllers use `@Controller({ path: 'x', version: '1' })`; response DTOs need accurate `@Api*Response({ type })` metadata.

## Migrations gotchas

- `start:dev` auto-applies migrations on bootstrap; `pnpm db:migrate` applies them directly. Stop a running dev server before resetting schema state.
- Drizzle bookkeeping is in `drizzle.__drizzle_migrations`, not `public`. Never delete `drizzle/meta/*` or generated SQL; stale metadata can make migrations replay.
- Use `pnpm db:reset` for a clean local reset. Inspect tables through the Compose service, not a hardcoded container name:
  ```bash
  docker compose exec -T postgres psql -U delivery_user -d delivery_db_mk -c "\\dt"
  ```
- `db:reset` is destructive: it drops `public` and the `drizzle` schema, then migrates and base-seeds.

## pnpm native-build approval

`pnpm-workspace.yaml` approves build scripts for `bcrypt` and `esbuild`. Approve any new package with install scripts there or pnpm may block installs and database scripts.
