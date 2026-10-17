# Permission and Role-Based Access Control (RBAC)

This document describes the implemented API behavior. The permission catalog is fixed in code; roles and their grant sets are managed separately.

## Model

Authorization follows `user → role → permission grants`. A user's `role_id` references `roles.id`; `role_permissions` connects roles to rows in the permission catalog. The global `JwtAuthGuard` authenticates the active user, and the global `PermissionsGuard` checks the endpoint's `@RequirePermissions(...)` requirement. Routes marked `@Public()` do not require a token; otherwise a valid bearer token is required.

## Fixed permission catalog

`src/common/auth/permission-keys.ts` is the source of truth for the catalog. It defines a literal `PermissionKey` union and **13 modules / 42 permission keys**:

| Module | Actions |
|---|---|
| `users` | `create`, `read`, `update`, `delete` |
| `roles` | `create`, `read`, `update`, `delete` |
| `permissions` | `read`, `update` |
| `shops` | `create`, `read`, `update`, `delete` |
| `customers` | `create`, `read`, `update`, `delete` |
| `riders` | `create`, `read`, `update`, `delete` |
| `orders` | `create`, `read`, `update`, `cancel`, `update_after_approval` |
| `deliveries` | `read`, `update`, `approve` |
| `townships` | `create`, `read`, `update`, `delete` |
| `partners` | `create`, `read`, `update`, `delete` |
| `shop-portal` | `read` |
| `shop-reports` | `export` |
| `reports` | `read`, `export` |

The seed script synchronizes database catalog rows from this list. `GET /api/v1/permissions` reads the catalog grouped by module. There are no endpoints or permission keys for creating or deleting catalog entries. Adding a key is a code change followed by reseeding; do not treat a role grant as a new permission definition.

`permissions.read` reads catalog/grants. `permissions.update` replaces a role's grant set through `PUT /api/v1/permissions/roles/:roleId`. The caller can only grant keys in its own effective set; self-modification is blocked, and a non-system caller cannot modify the OWNER or ADMIN role.

## Seeded roles and grants

`scripts/seed.ts` seeds five roles; `OWNER` is the only system role (`is_system=true`). The grants are:

| Role | Seeded effective grants |
|---|---|
| `OWNER` | Entire current catalog. System roles short-circuit grant-row lookup, so OWNER has no `role_permissions` rows. |
| `ADMIN` | All 42 catalog keys. |
| `OFFICER` | `orders.create`, `orders.read`, `orders.update`, `orders.cancel`, `orders.update_after_approval`; `deliveries.read`, `deliveries.update`, `deliveries.approve`; `townships.read/create/update/delete`; `partners.read/create/update/delete`; `reports.read`, `reports.export`. |
| `RIDER` | `deliveries.read`, `deliveries.update`. |
| `SHOP` | `shop-portal.read`, `shop-reports.export`. |

OWNER receives the current database catalog whenever effective permissions are requested. Other roles receive their `role_permissions` grants. The service caches non-system grants for up to 60 seconds and clears its cache when grants are replaced.

The `delivery-partners` feature module uses the `partners.*` permission namespace.

## API surface

All paths below are under `/api/v1` and, except login/public health, require authentication.

| Endpoint | Purpose | Permission |
|---|---|---|
| `GET /permissions` | Read fixed catalog grouped by module | `permissions.read` |
| `GET /permissions/roles/:roleId` | Read a role's effective permissions | `permissions.read` |
| `PUT /permissions/roles/:roleId` | Replace a role's permission grants | `permissions.update` |
| `GET /roles` and `GET /roles/:id` | List/read roles | `roles.read` |
| `POST /roles` | Create a role | `roles.create` |
| `PATCH /roles/:id` | Update role description | `roles.update` |
| `DELETE /roles/:id` | Delete an unused role | `roles.delete` |

User and role assignment endpoints use `users.*` and `roles.*` keys. Route requirements are declared in the controllers; the grant table alone does not create or authorize a route. An authenticated route without a permission decorator permits any authenticated role, so new routes should be annotated explicitly.

## Security notes

- Never return `passwordHash`/`password_hash` in API responses. Passwords are bcrypt-hashed; authentication uses access tokens.
- Permissions are role-level; there are no per-user permission overrides.
- The API's role grant interface is dynamic, but the key catalog is not. The currently seeded role grants are defaults and can be changed by authorized grant management.
- `scripts/seed.ts` is authoritative for seed role names and grants. This documentation must be updated if that mapping or the fixed catalog changes.
