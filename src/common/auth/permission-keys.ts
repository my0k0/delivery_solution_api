/**
 * Fixed permission catalog — the single source of truth for every permission
 * key the system knows. Each module maps to the actions its users can hold.
 *
 * The catalog is seeded (scripts/seed.ts) and read-only at runtime: no
 * `permissions.create` / `permissions.delete` keys exist, and the API exposes
 * no endpoint to mutate it. Adding a future module = add one entry here and
 * re-seed (a code change, not a runtime action).
 *
 * View ≡ read, edit ≡ update — there is no separate "view"/"edit" action.
 */
export const MODULE_ACTIONS = {
  users: ['create', 'read', 'update', 'delete', 'export', 'import'],
  roles: ['create', 'read', 'update', 'delete'],
  permissions: ['read', 'update'],
  shops: ['create', 'read', 'update', 'delete', 'export', 'import'],
  customers: ['create', 'read', 'update', 'delete', 'export', 'import'],
  riders: ['create', 'read', 'update', 'delete', 'export', 'import'],
  orders: [
    'create',
    'read',
    'update',
    'delete',
    'export',
    'import',
    'cancel',
    'update_costs',
    'update_after_approval',
  ],
  deliveries: [
    'create',
    'read',
    'update',
    'delete',
    'export',
    'import',
    'approve',
  ],
  townships: ['create', 'read', 'update', 'delete', 'export', 'import'],
  partners: ['create', 'read', 'update', 'delete', 'export', 'import'],
  ways: [
    'create',
    'read',
    'update',
    'delete',
    'export',
    'import',
    'override_commission',
  ],
  'shop-portal': ['read'],
  'shop-reports': ['export'],
  reports: ['read', 'export'],
} as const satisfies Record<string, readonly string[]>;

export type ModuleName = keyof typeof MODULE_ACTIONS;
export type ActionName = (typeof MODULE_ACTIONS)[ModuleName][number];

/** Exact `module.action` union — a literal string type, not `string`. */
export type PermissionKey = {
  [M in ModuleName]: `${M}.${(typeof MODULE_ACTIONS)[M][number]}`;
}[ModuleName];

/** Flat list of every known key, generated from the module map (stable order). */
export const PERMISSION_KEYS: readonly PermissionKey[] = (
  Object.entries(MODULE_ACTIONS) as [ModuleName, readonly string[]][]
).flatMap(([module, actions]) =>
  actions.map((action) => `${module}.${action}` as PermissionKey),
);
