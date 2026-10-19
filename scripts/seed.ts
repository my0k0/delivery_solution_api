import { config } from 'dotenv';
import postgres from 'postgres';
import bcrypt from 'bcrypt';
import { normalizeEmail } from '../src/common/utils/normalize.util.js';
import {
  MODULE_ACTIONS,
  PERMISSION_KEYS,
} from '../src/common/auth/permission-keys.js';
import type { ModuleName } from '../src/common/auth/permission-keys.js';

config({ path: ['.env.local', '.env'], quiet: true });

const OWNER_EMAIL = normalizeEmail(
  process.env.SEED_OWNER_EMAIL ?? 'owner@mail.com',
);
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? 'Password1234';
const OWNER_NAME = process.env.SEED_OWNER_NAME ?? 'System Owner';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to seed.');
}

const sql = postgres(databaseUrl);
const permissionNames = new Set<string>(PERMISSION_KEYS);

/** Fixed permission catalog — generated from MODULE_ACTIONS (read-only at runtime). */
const CATALOG: Array<{ name: string; module: ModuleName }> = (
  Object.entries(MODULE_ACTIONS) as [ModuleName, readonly string[]][]
).flatMap(([module, actions]) =>
  actions.map((action) => ({ name: `${module}.${action}`, module })),
);

/** Seed role set — closed union so lookups are typed, no undefined for known keys. */
const SEED_ROLE_NAMES = ['OWNER', 'ADMIN', 'OFFICER', 'RIDER', 'SHOP'] as const;
type SeedRoleName = (typeof SEED_ROLE_NAMES)[number];

/** Non-null role id lookup — roles are seeded just above, never missing. */
function roleIdRequired(
  roleIds: Map<SeedRoleName, string>,
  roleName: SeedRoleName,
): string {
  const id = roleIds.get(roleName);
  if (!id) throw new Error(`Role '${roleName}' was not seeded`);
  return id;
}

/** seed grants: role name → keys (OWNER entries ignored — system role holds all). */
const GRANTS: Record<Exclude<SeedRoleName, 'OWNER'>, string[]> = {
  ADMIN: [...PERMISSION_KEYS],
  OFFICER: [
    'orders.create',
    'orders.read',
    'orders.update',
    'orders.cancel',
    'orders.update_after_approval',
    'deliveries.read',
    'deliveries.update',
    'deliveries.approve',
    'townships.read',
    'townships.create',
    'townships.update',
    'townships.delete',
    'partners.read',
    'partners.create',
    'partners.update',
    'partners.delete',
    'reports.read',
    'reports.export',
    'rider-handovers.create',
    'rider-handovers.read',
    'rider-handovers.update',
  ],
  RIDER: ['deliveries.read', 'deliveries.update'],
  SHOP: ['shop-portal.read', 'shop-reports.export'],
};

async function removeUnknownPermissions(): Promise<void> {
  const existingPermissions = await sql<{ id: string; name: string }[]>`
    select id, name from permissions
  `;
  for (const permission of existingPermissions) {
    if (!permissionNames.has(permission.name)) {
      await sql`delete from permissions where id = ${permission.id}`;
    }
  }
}

async function upsertPermissionNames(): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const { name, module } of CATALOG) {
    const [row] = await sql<{ id: string }[]>`
      insert into permissions (name, module, description)
      values (${name}, ${module}, ${name})
      on conflict (name) do update set module = excluded.module
      returning id
    `;
    ids.set(name, row.id);
  }
  return ids;
}

async function seedRoles(): Promise<Map<SeedRoleName, string>> {
  const roleIds = new Map<SeedRoleName, string>();
  for (const roleName of SEED_ROLE_NAMES) {
    const [row] = await sql<{ id: string }[]>`
      insert into roles (name, description, is_system)
      values (${roleName}, ${`${roleName} role`}, ${roleName === 'OWNER'})
      on conflict (name) do update set is_system = excluded.is_system
      returning id
    `;
    roleIds.set(roleName, row.id);
  }
  return roleIds;
}

async function seedGrants(
  roleIds: Map<SeedRoleName, string>,
  permissionIds: Map<string, string>,
): Promise<void> {
  // System role (OWNER) needs no grant rows — guard short-circuits to full catalog.
  await sql`delete from role_permissions where role_id = ${roleIdRequired(roleIds, 'OWNER')}`;

  for (const [role, keys] of Object.entries(GRANTS) as [
    Exclude<SeedRoleName, 'OWNER'>,
    string[],
  ][]) {
    const roleId = roleIdRequired(roleIds, role);
    await sql`delete from role_permissions where role_id = ${roleId}`;
    for (const key of keys) {
      const permissionId = permissionIds.get(key);
      if (!permissionId) continue;
      await sql`
        insert into role_permissions (role_id, permission_id)
        values (${roleId}, ${permissionId})
        on conflict (role_id, permission_id) do nothing
      `;
    }
  }
}

async function main(): Promise<void> {
  await removeUnknownPermissions();
  const permissionIds = await upsertPermissionNames();
  const roleIds = await seedRoles();
  await seedGrants(roleIds, permissionIds);

  // Backfill any user missing a role (created before the RBAC migration) to OFFICER.
  await sql`
    update users set role_id = r.id
    from roles r
    where users.role_id is null and r.name = 'OFFICER'
  `;

  const passwordHash = await bcrypt.hash(OWNER_PASSWORD, 10);

  // Seed OWNER
  const existingOwner = await sql<
    { id: string }[]
  >`select id from users where email = ${OWNER_EMAIL}`;
  if (existingOwner.length === 0) {
    await sql`
      insert into users (name, email, password_hash, role_id, status)
      values (${OWNER_NAME}, ${OWNER_EMAIL}, ${passwordHash}, ${roleIdRequired(roleIds, 'OWNER')}, 'ACTIVE')
    `;
    console.log(
      `Seeded OWNER: ${OWNER_NAME} <${OWNER_EMAIL}> (default password: ${OWNER_PASSWORD})`,
    );
  } else {
    console.log(`OWNER already exists for ${OWNER_EMAIL}, skipping`);
  }

  // Seed 2 admins
  const admins = [
    { name: 'Admin 1', email: 'admin1@mail.com' },
    { name: 'Admin 2', email: 'admin2@mail.com' },
  ];
  for (const admin of admins) {
    const normalized = normalizeEmail(admin.email);
    const [existing] = await sql<
      { id: string }[]
    >`select id from users where email = ${normalized}`;
    if (existing) {
      console.log(`Admin ${normalized} already exists, skipping`);
      continue;
    }
    await sql`
      insert into users (name, email, password_hash, role_id, status)
      values (${admin.name}, ${normalized}, ${passwordHash}, ${roleIdRequired(roleIds, 'ADMIN')}, 'ACTIVE')
    `;
    console.log(
      `Seeded ADMIN: ${admin.name} <${normalized}> (default password: ${OWNER_PASSWORD})`,
    );
  }
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
