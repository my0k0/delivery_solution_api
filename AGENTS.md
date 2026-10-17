# AGENTS.md

NestJS 12 (Express) + TypeScript API for a single delivery company's operations. PostgreSQL 18/Drizzle, Redis, Swagger, Vitest. Single package; only commit or push when the user explicitly asks.

## Skills — invoke before task-specific code

Check the table at the start of each task; if a row matches, invoke the skill before writing code. Multiple rows can apply.

| Task touches | Invoke |
|---|---|
| Any frontend/UI work | `ui-ux-pro-max` |
| Landing/marketing pages or aesthetic polish | `taste` on top of `ui-ux-pro-max` |
| Charts, graphs, KPI tiles, data visualization | `dataviz` before the first chart line |
| Logos, decks, icon sets, brand/social assets | `ui-ux-pro-max:design` |
| Library/framework/SDK/CLI docs question | Context7 (`ctx7` CLI per local rules) |
| Code review / quality pass on changes | `code-review` |

Utility-only backend work needs no frontend skill.

## Project and phase status

Foundation, Phase 1 (Users/Auth/RBAC), and Phase 2 (master data) are complete. Phases 3–5 are superseded by `docs/delivery-workflow-v2.md`; workflow v2 phases A–E are complete: schema/state/RBAC, office orders and approval, per-order commission, reports/dashboards, and shop portal. Phase 6 (returns/payment ledger/reconciliation) remains blocked; Phase 7 (notifications/Viber) is later; Phase 8 reporting is partially delivered by phases D/E, with additional scope still to be defined. See `README.md`, `PLAN.md`, and the workflow document's As built section.

## Type safety / code quality (mandatory)

- No `any`. Type every request/response DTO and explicit return type; use `unknown` at trust boundaries.
- No `@ts-ignore`, `@ts-expect-error`, or bare non-null assertion to silence the compiler. Narrow unknown values with guards.
- Strict TypeScript remains enabled. Use `satisfies` for const arrays bounded by broader types.
- Drizzle row types use `.$inferSelect`/`.$inferInsert`; don't return bare `Record<string, unknown>` from services.
- ESM under `nodenext`: relative imports must end in `.js`.

## Commands

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed          # base roles, fixed permission catalog, owner/admin accounts
pnpm db:seed:demo     # disposable development fixtures; never production
pnpm db:reset         # destructive schema/data drop, migrate, then base seed
pnpm start:dev        # watch mode; migrations auto-apply at bootstrap
```

Quality gate:

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm test
pnpm test:e2e
```

E2E requires `docker compose up -d` and writes to the Compose Postgres database. Do not run against a database you care about. `pnpm db:reset` operates on the Compose `postgres` service and drops all data before migration and base seeding; demo fixtures are separate.

## Environment

- `.env` is gitignored and may intentionally differ from `.env.example`; local Postgres commonly uses host port 5433 while the example uses 5432. Never overwrite `.env` from the example without checking it.
- `APP_TIMEZONE` defaults to `Asia/Yangon`; use it for business-day boundaries and date grouping.
- App config is validated in `src/config/env.validation.ts`; `DATABASE_URL` and `JWT_SECRET` are required. `drizzle.config.ts` loads environment files itself.

## Auth / RBAC

- `src/app.module.ts` registers global JWT authentication and permission guards. Every route needs a bearer token unless marked `@Public()`.
- Protected routes declare `@RequirePermissions('module.action')`; use only keys in `src/common/auth/permission-keys.ts`.
- The permission catalog is fixed: **13 modules / 42 keys** (`users`, `roles`, `permissions`, `shops`, `customers`, `riders`, `orders`, `deliveries`, `townships`, `partners`, `shop-portal`, `shop-reports`, `reports`). Permission keys are seeded and cannot be created/deleted at runtime; role grants can be replaced.
- Seed roles are `OWNER`, `ADMIN`, `OFFICER`, `RIDER`, and `SHOP`. `scripts/seed.ts` is authoritative for the exact grants. OWNER is a system role and receives the whole current catalog.
- Never expose `passwordHash`. Authentication uses access tokens; the auth guard rebuilds the active user from the database.

## Architecture

- Cross-cutting: `src/common/auth/`, `src/common/database/`, `src/common/health/`, `src/common/utils/`, and `src/config/`.
- Registered feature modules: `auth`, `users`, `roles`, `permissions`, `shops`, `customers`, `riders`, `orders`, `townships`, `delivery-partners` (permission module `partners`), `reports`, and `shop-portal`.
- Each feature owns its controller/service/DTOs and schema. Every new table must be re-exported from `src/common/database/schema.ts` or Drizzle Kit will not see it.
- Controllers use `@Controller({ path: 'x', version: '1' })`; all routes are under `/api/v1`. `/api/v1/docs-json` is the canonical generated OpenAPI contract; response DTOs need accurate `@Api*Response({ type })` metadata.

## Conventions

- `OrderStateService` owns all order state transitions and status-history writes. Create the initial state and call `recordInitialStateInTransaction` in the same transaction; never change status through an ordinary order update or write transitions outside this service.
- Money is SQL `numeric` and decimal strings at TypeScript/API boundaries; never use JavaScript floating-point arithmetic for money.
- Business-day boundaries and date grouping use `APP_TIMEZONE`.
- Shop-portal responses use dedicated shop DTOs. Scope every shop query using the `shopId` on the authenticated user's record, never a client-supplied shop id.
- CSV/XLSX exports go through the formula-injection guard in `src/reports/report-export.util.ts`.
- Partner-assigned orders never have a way or rider commission; preserve the schema constraint and clear `wayId` when assigning a partner.
- Relative ESM imports end in `.js`; every new schema table is re-exported from the central database schema.

## Migrations gotchas

- `start:dev` applies migrations on bootstrap; `pnpm db:migrate` applies them directly. Stop a running dev server before resetting schema state.
- Drizzle bookkeeping is in `drizzle.__drizzle_migrations`, not `public`. Do not delete `drizzle/meta/*` or generated SQL; stale metadata can make migrations replay.
- For a clean local reset use `pnpm db:reset`. To inspect tables, use the Compose service rather than a generated container name:
  ```bash
  docker compose exec -T postgres psql -U delivery_user -d delivery_db -c "\\dt"
  ```
- The reset script drops `public` and the Drizzle bookkeeping schema, then migrates and base-seeds. It is destructive.

## pnpm native-build approval

`pnpm-workspace.yaml` holds build-script approvals for `bcrypt` and `esbuild`. Approve any new package with install scripts there or pnpm may block installs and database scripts.
