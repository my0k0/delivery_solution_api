import { config } from 'dotenv';
import bcrypt from 'bcrypt';
import postgres from 'postgres';
import type {
  AssigneeSnapshot,
  AssigneeType,
  OrderStatus,
} from '../src/orders/order.schema.js';

config({ path: ['.env.local', '.env'], quiet: true });

if (process.env.NODE_ENV === 'production') {
  throw new Error('The demo seed is disabled when NODE_ENV=production.');
}

const DEMO_PASSWORD = 'Password1234';
const DEMO_PASSWORD_HASH = await bcrypt.hash(DEMO_PASSWORD, 10);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error('DATABASE_URL is required to seed demo data.');

const sql = postgres(databaseUrl);

const partnerDefinitions = [
  {
    name: 'Demo Swift Partner',
    phone: '09111111001',
    note: 'Demo partner one',
  },
  {
    name: 'Demo Rapid Partner',
    phone: '09111111002',
    note: 'Demo partner two',
  },
] as const;

const shopDefinitions = [
  {
    name: 'Demo Shop One',
    phone: '09222222001',
    address: '1 Demo Street',
    channelType: 'VIBER',
    channelName: 'demo-shop-one',
  },
  {
    name: 'Demo Shop Two',
    phone: '09222222002',
    address: '2 Demo Street',
    channelType: 'VIBER',
    channelName: 'demo-shop-two',
  },
  {
    name: 'Demo Shop Three',
    phone: '09222222003',
    address: '3 Demo Street',
    channelType: 'VIBER',
    channelName: 'demo-shop-three',
  },
] as const;

const customerDefinitions = [
  {
    name: 'Demo Customer One',
    phone: '09333333001',
    address: '1 Customer Road',
  },
  {
    name: 'Demo Customer Two',
    phone: '09333333002',
    address: '2 Customer Road',
  },
  {
    name: 'Demo Customer Three',
    phone: '09333333003',
    address: '3 Customer Road',
  },
  {
    name: 'Demo Customer Four',
    phone: '09333333004',
    address: '4 Customer Road',
  },
  {
    name: 'Demo Customer Five',
    phone: '09333333005',
    address: '5 Customer Road',
  },
  {
    name: 'Demo Shop Portal Rider Customer',
    phone: '09333333006',
    address: '6 Customer Road',
  },
  {
    name: 'Demo Shop Portal Partner Customer',
    phone: '09333333007',
    address: '7 Customer Road',
  },
  {
    name: 'Demo Shop Portal Status Customer',
    phone: '09333333008',
    address: '8 Customer Road',
  },
] as const;

const riderDefinitions = [
  {
    name: 'Demo Rider One',
    email: 'rider1@demo.delivery.local',
    phone: '09444444001',
  },
  {
    name: 'Demo Rider Two',
    email: 'rider2@demo.delivery.local',
    phone: '09444444002',
  },
] as const;

const shopUserDefinitions = [
  { name: 'Demo Shop One Login', email: 'shop1@demo.delivery.local' },
  { name: 'Demo Shop Two Login', email: 'shop2@demo.delivery.local' },
  { name: 'Demo Shop Three Login', email: 'shop3@demo.delivery.local' },
] as const;

interface DemoOrderDefinition {
  trackingCode: string;
  status: OrderStatus;
  shopIndex: number;
  customerIndex: number;
  townshipIndex: number;
  assigneeType: AssigneeType | null;
  assigneeIndex: number | null;
  packagePrice: string;
  deliveryFee: string;
  isPackagePaidToShop: boolean;
  isFeePaidToShop: boolean;
  notes: string;
  historyScenario?: 'POSTPONED' | 'SEND_BACK';
  historyReason?: string;
  historyInternalNote?: string;
  estimatedDateOffset?: number;
}

const orderDefinitions = [
  {
    trackingCode: 'DEMO-ORD-001',
    status: 'PENDING',
    shopIndex: 0,
    customerIndex: 0,
    townshipIndex: 2,
    assigneeType: null,
    assigneeIndex: null,
    packagePrice: '47000.00',
    deliveryFee: '3500.00',
    isPackagePaidToShop: false,
    isFeePaidToShop: false,
    notes: 'Collect package and delivery fee.',
  },
  {
    trackingCode: 'DEMO-ORD-002',
    status: 'PENDING',
    shopIndex: 1,
    customerIndex: 1,
    townshipIndex: 2,
    assigneeType: null,
    assigneeIndex: null,
    packagePrice: '18000.00',
    deliveryFee: '3500.00',
    isPackagePaidToShop: false,
    isFeePaidToShop: true,
    notes: 'Delivery fee already paid.',
  },
  {
    trackingCode: 'DEMO-ORD-003',
    status: 'ASSIGNED',
    shopIndex: 0,
    customerIndex: 2,
    townshipIndex: 0,
    assigneeType: 'RIDER',
    assigneeIndex: 0,
    packagePrice: '26000.00',
    deliveryFee: '3500.00',
    isPackagePaidToShop: false,
    isFeePaidToShop: false,
    notes: 'Call before arrival.',
  },
  {
    trackingCode: 'DEMO-ORD-004',
    status: 'ASSIGNED',
    shopIndex: 1,
    customerIndex: 3,
    townshipIndex: 0,
    assigneeType: 'RIDER',
    assigneeIndex: 1,
    packagePrice: '32000.00',
    deliveryFee: '3500.00',
    isPackagePaidToShop: true,
    isFeePaidToShop: false,
    notes: 'Package price paid to shop.',
  },
  {
    trackingCode: 'DEMO-ORD-005',
    status: 'ASSIGNED',
    shopIndex: 2,
    customerIndex: 4,
    townshipIndex: 1,
    assigneeType: 'PARTNER',
    assigneeIndex: 0,
    packagePrice: '54000.00',
    deliveryFee: '4500.00',
    isPackagePaidToShop: false,
    isFeePaidToShop: false,
    notes: 'Partner delivery.',
  },
  {
    trackingCode: 'DEMO-ORD-006',
    status: 'ASSIGNED',
    shopIndex: 2,
    customerIndex: 0,
    townshipIndex: 0,
    assigneeType: 'RIDER',
    assigneeIndex: 0,
    packagePrice: '15000.00',
    deliveryFee: '3500.00',
    isPackagePaidToShop: false,
    isFeePaidToShop: true,
    notes: 'Fee already paid to shop.',
  },
  {
    trackingCode: 'DEMO-ORD-007',
    status: 'AWAITING_APPROVAL',
    shopIndex: 0,
    customerIndex: 1,
    townshipIndex: 0,
    assigneeType: 'RIDER',
    assigneeIndex: 0,
    packagePrice: '47000.00',
    deliveryFee: '3500.00',
    isPackagePaidToShop: false,
    isFeePaidToShop: false,
    notes: 'Rider submitted delivery; awaiting office approval.',
  },
  {
    trackingCode: 'DEMO-ORD-008',
    status: 'DELIVERED',
    shopIndex: 1,
    customerIndex: 2,
    townshipIndex: 0,
    assigneeType: 'RIDER',
    assigneeIndex: 1,
    packagePrice: '22000.00',
    deliveryFee: '3500.00',
    isPackagePaidToShop: true,
    isFeePaidToShop: false,
    notes: 'Approved rider delivery.',
  },
  {
    trackingCode: 'DEMO-ORD-009',
    status: 'DELIVERED',
    shopIndex: 2,
    customerIndex: 3,
    townshipIndex: 1,
    assigneeType: 'PARTNER',
    assigneeIndex: 1,
    packagePrice: '65000.00',
    deliveryFee: '4500.00',
    isPackagePaidToShop: true,
    isFeePaidToShop: true,
    notes: 'Partner delivery marked delivered by office.',
  },
  {
    trackingCode: 'DEMO-ORD-010',
    status: 'CANCELLED',
    shopIndex: 0,
    customerIndex: 4,
    townshipIndex: 2,
    assigneeType: null,
    assigneeIndex: null,
    packagePrice: '19000.00',
    deliveryFee: '5000.00',
    isPackagePaidToShop: false,
    isFeePaidToShop: false,
    notes: 'Cancelled demo order.',
  },
  {
    trackingCode: 'DEMO-ORD-011',
    status: 'CANCELLED',
    shopIndex: 1,
    customerIndex: 0,
    townshipIndex: 0,
    assigneeType: 'RIDER',
    assigneeIndex: 1,
    packagePrice: '28000.00',
    deliveryFee: '3500.00',
    isPackagePaidToShop: false,
    isFeePaidToShop: true,
    notes: 'Cancelled after assignment.',
  },
  {
    trackingCode: 'DEMO-ORD-012',
    status: 'CANCELLED',
    shopIndex: 2,
    customerIndex: 1,
    townshipIndex: 2,
    assigneeType: null,
    assigneeIndex: null,
    packagePrice: '36000.00',
    deliveryFee: '5000.00',
    isPackagePaidToShop: true,
    isFeePaidToShop: false,
    notes: 'Cancelled before assignment.',
  },
  {
    trackingCode: 'DEMO-ORD-013',
    status: 'ASSIGNED',
    shopIndex: 0,
    customerIndex: 5,
    townshipIndex: 0,
    assigneeType: 'RIDER',
    assigneeIndex: 0,
    packagePrice: '47000.00',
    deliveryFee: '3500.00',
    isPackagePaidToShop: false,
    isFeePaidToShop: false,
    notes: 'Shop portal rider privacy fixture.',
  },
  {
    trackingCode: 'DEMO-ORD-014',
    status: 'ASSIGNED',
    shopIndex: 0,
    customerIndex: 6,
    townshipIndex: 1,
    assigneeType: 'PARTNER',
    assigneeIndex: 0,
    packagePrice: '95000.00',
    deliveryFee: '4500.00',
    isPackagePaidToShop: false,
    isFeePaidToShop: false,
    notes: 'Shop portal partner privacy fixture.',
  },
  {
    trackingCode: 'DEMO-ORD-015',
    status: 'PENDING',
    shopIndex: 0,
    customerIndex: 7,
    townshipIndex: 2,
    assigneeType: null,
    assigneeIndex: null,
    packagePrice: '18000.00',
    deliveryFee: '3500.00',
    isPackagePaidToShop: false,
    isFeePaidToShop: true,
    notes: 'Postponed with a shop-visible reason.',
    historyScenario: 'POSTPONED',
    historyReason: 'Customer requested delivery tomorrow.',
    estimatedDateOffset: -1,
  },
  {
    trackingCode: 'DEMO-ORD-016',
    status: 'ASSIGNED',
    shopIndex: 0,
    customerIndex: 5,
    townshipIndex: 0,
    assigneeType: 'RIDER',
    assigneeIndex: 1,
    packagePrice: '26000.00',
    deliveryFee: '3500.00',
    isPackagePaidToShop: false,
    isFeePaidToShop: false,
    notes: 'Sent back with a private internal note.',
    historyScenario: 'SEND_BACK',
    historyReason: 'Please confirm the customer handoff.',
    historyInternalNote: 'Call customer before retry; never show this to the shop.',
  },
  {
    trackingCode: 'DEMO-ORD-017',
    status: 'CANCELLED',
    shopIndex: 0,
    customerIndex: 6,
    townshipIndex: 2,
    assigneeType: null,
    assigneeIndex: null,
    packagePrice: '36000.00',
    deliveryFee: '5000.00',
    isPackagePaidToShop: true,
    isFeePaidToShop: false,
    notes: 'Cancelled shop portal fixture.',
  },
  {
    trackingCode: 'DEMO-ORD-018',
    status: 'CANCELLED',
    shopIndex: 0,
    customerIndex: 7,
    townshipIndex: 2,
    assigneeType: null,
    assigneeIndex: null,
    packagePrice: '19000.00',
    deliveryFee: '5000.00',
    isPackagePaidToShop: false,
    isFeePaidToShop: false,
    notes: 'Cancelled shop portal fixture.',
  },
  {
    trackingCode: 'DEMO-ORD-019',
    status: 'DELIVERED',
    shopIndex: 0,
    customerIndex: 5,
    townshipIndex: 0,
    assigneeType: 'RIDER',
    assigneeIndex: 0,
    packagePrice: '47000.00',
    deliveryFee: '3500.00',
    isPackagePaidToShop: true,
    isFeePaidToShop: false,
    notes: 'Delivered shop portal fixture.',
  },
  {
    trackingCode: 'DEMO-ORD-020',
    status: 'PENDING',
    shopIndex: 0,
    customerIndex: 7,
    townshipIndex: 2,
    assigneeType: null,
    assigneeIndex: null,
    packagePrice: '95000.00',
    deliveryFee: '3500.00',
    isPackagePaidToShop: false,
    isFeePaidToShop: false,
    notes: 'Open and past estimated delivery date.',
    estimatedDateOffset: -5,
  },
] as const satisfies readonly DemoOrderDefinition[];

interface DemoHistoryEntry {
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  note: string;
  reason: string | null;
  internalNote: string | null;
  previousAssignee: AssigneeSnapshot | null;
  newAssignee: AssigneeSnapshot | null;
}

function historyForOrder(
  order: DemoOrderDefinition,
  riderId: string | null,
  partnerId: string | null,
  firstRiderId: string,
): DemoHistoryEntry[] {
  const assignee: AssigneeSnapshot | null =
    order.assigneeType === null
      ? null
      : {
          type: order.assigneeType,
          riderId: order.assigneeType === 'RIDER' ? riderId : null,
          partnerId: order.assigneeType === 'PARTNER' ? partnerId : null,
        };
  const initialStatus: OrderStatus = assignee ? 'ASSIGNED' : 'PENDING';
  const initial: DemoHistoryEntry = {
    fromStatus: null,
    toStatus: initialStatus,
    note: 'Demo order registered',
    reason: null,
    internalNote: null,
    previousAssignee: null,
    newAssignee: assignee,
  };
  const transition = (
    fromStatus: OrderStatus,
    toStatus: OrderStatus,
    note: string,
    reason: string | null = null,
    internalNote: string | null = null,
  ): DemoHistoryEntry => ({
    fromStatus,
    toStatus,
    note,
    reason,
    internalNote,
    previousAssignee: assignee,
    newAssignee: assignee,
  });

  if (order.historyScenario === 'POSTPONED') {
    return [
      {
        ...initial,
        toStatus: 'ASSIGNED',
        newAssignee: { type: 'RIDER', riderId: firstRiderId, partnerId: null },
      },
      {
        ...transition('ASSIGNED', 'PENDING', 'Delivery postponed', order.historyReason ?? null),
        previousAssignee: { type: 'RIDER', riderId: firstRiderId, partnerId: null },
        newAssignee: null,
      },
    ];
  }
  if (order.historyScenario === 'SEND_BACK') {
    return [
      initial,
      transition('ASSIGNED', 'AWAITING_APPROVAL', 'Rider submitted delivery for approval'),
      transition('AWAITING_APPROVAL', 'ASSIGNED', 'Delivery submission sent back for correction', order.historyReason ?? null, order.historyInternalNote ?? null),
    ];
  }

  switch (order.status) {
    case 'PENDING':
    case 'ASSIGNED':
      return [initial];
    case 'AWAITING_APPROVAL':
      return [
        initial,
        transition(
          'ASSIGNED',
          'AWAITING_APPROVAL',
          'Rider submitted delivery for approval',
        ),
      ];
    case 'DELIVERED':
      return order.assigneeType === 'PARTNER'
        ? [
            initial,
            transition(
              'ASSIGNED',
              'DELIVERED',
              'Partner order marked delivered by office',
            ),
          ]
        : [
            initial,
            transition(
              'ASSIGNED',
              'AWAITING_APPROVAL',
              'Rider submitted delivery for approval',
            ),
            transition('AWAITING_APPROVAL', 'DELIVERED', 'Delivery approved'),
          ];
    case 'CANCELLED':
      return [
        { ...initial, toStatus: 'PENDING', newAssignee: null },
        {
          ...transition(
            'PENDING',
            'CANCELLED',
            'Order cancelled',
            'Demo cancellation',
          ),
          previousAssignee: null,
          newAssignee: null,
        },
      ];
  }
}

async function main(): Promise<void> {
  await sql.begin(async (transaction) => {
    const [shopRole] = await transaction<{ id: string }[]>`
      select id from roles where name = 'SHOP'
    `;
    const [riderRole] = await transaction<{ id: string }[]>`
      select id from roles where name = 'RIDER'
    `;
    const [owner] = await transaction<{ id: string }[]>`
      select id from users where email = 'owner@mail.com' limit 1
    `;
    if (!shopRole || !riderRole) {
      throw new Error(
        'SHOP and RIDER roles are required; run pnpm db:seed first.',
      );
    }

    const partnerIds: string[] = [];
    for (const partner of partnerDefinitions) {
      const [row] = await transaction<{ id: string }[]>`
        insert into delivery_partners (name, phone, note, is_active)
        values (${partner.name}, ${partner.phone}, ${partner.note}, true)
        on conflict (name) do update set
          phone = excluded.phone,
          note = excluded.note,
          is_active = true,
          updated_at = now()
        returning id
      `;
      partnerIds.push(row.id);
    }

    const shopIds: string[] = [];
    for (const shop of shopDefinitions) {
      const [row] = await transaction<{ id: string }[]>`
        insert into shops (name, phone, address, channel_type, channel_name)
        values (${shop.name}, ${shop.phone}, ${shop.address}, ${shop.channelType}, ${shop.channelName})
        on conflict (name) do update set
          phone = excluded.phone,
          address = excluded.address,
          channel_type = excluded.channel_type,
          channel_name = excluded.channel_name,
          updated_at = now()
        returning id
      `;
      shopIds.push(row.id);
    }

    for (const [index, shop] of shopDefinitions.entries()) {
      const login = shopUserDefinitions[index];
      await transaction`
        insert into users (name, email, password_hash, role_id, shop_id, status, password_changed_at)
        values (${login.name}, ${login.email}, ${DEMO_PASSWORD_HASH}, ${shopRole.id}, ${shopIds[index]}, 'ACTIVE', now())
        on conflict (email) do update set
          name = excluded.name,
          password_hash = excluded.password_hash,
          role_id = excluded.role_id,
          shop_id = excluded.shop_id,
          status = 'ACTIVE',
          password_changed_at = now(),
          updated_at = now()
      `;
    }

    const riderIds: string[] = [];
    for (const rider of riderDefinitions) {
      const [user] = await transaction<{ id: string }[]>`
        insert into users (name, email, phone, password_hash, role_id, status, password_changed_at)
        values (${rider.name}, ${rider.email}, ${rider.phone}, ${DEMO_PASSWORD_HASH}, ${riderRole.id}, 'ACTIVE', now())
        on conflict (email) do update set
          name = excluded.name,
          phone = excluded.phone,
          password_hash = excluded.password_hash,
          role_id = excluded.role_id,
          status = 'ACTIVE',
          password_changed_at = now(),
          updated_at = now()
        returning id
      `;
      const [riderRow] = await transaction<{ id: string }[]>`
        insert into riders (user_id)
        values (${user.id})
        on conflict (user_id) do update set updated_at = now()
        returning id
      `;
      riderIds.push(riderRow.id);
    }

    const customerIds: string[] = [];
    for (const customer of customerDefinitions) {
      const [existing] = await transaction<{ id: string }[]>`
        select id from customers where name = ${customer.name} limit 1
      `;
      if (existing) {
        const [updated] = await transaction<{ id: string }[]>`
          update customers set phone = ${customer.phone}, address = ${customer.address}, updated_at = now()
          where id = ${existing.id}
          returning id
        `;
        customerIds.push(updated.id);
      } else {
        const [created] = await transaction<{ id: string }[]>`
          insert into customers (name, phone, address)
          values (${customer.name}, ${customer.phone}, ${customer.address})
          returning id
        `;
        customerIds.push(created.id);
      }
    }

    const townshipDefinitions = [
      {
        name: 'Demo Central',
        fee: '3500.00',
        commission: '500.00',
        leadTimeDays: 1,
        assigneeType: 'RIDER',
        riderIndex: 0,
        partnerIndex: null,
      },
      {
        name: 'Demo North',
        fee: '4500.00',
        commission: '700.00',
        leadTimeDays: 2,
        assigneeType: 'PARTNER',
        riderIndex: null,
        partnerIndex: 0,
      },
      {
        name: 'Demo South',
        fee: '5000.00',
        commission: '600.00',
        leadTimeDays: 3,
        assigneeType: null,
        riderIndex: null,
        partnerIndex: null,
      },
    ] as const;
    const townshipIds: string[] = [];
    for (const township of townshipDefinitions) {
      const riderId =
        township.riderIndex === null ? null : riderIds[township.riderIndex];
      const partnerId =
        township.partnerIndex === null
          ? null
          : partnerIds[township.partnerIndex];
      const [row] = await transaction<{ id: string }[]>`
        insert into townships (name, default_delivery_fee, default_commission_fee, lead_time_days, default_assignee_type, default_rider_id, default_partner_id)
        values (${township.name}, ${township.fee}, ${township.commission}, ${township.leadTimeDays}, ${township.assigneeType}, ${riderId}, ${partnerId})
        on conflict (name) do update set
          default_delivery_fee = excluded.default_delivery_fee,
          default_commission_fee = excluded.default_commission_fee,
          lead_time_days = excluded.lead_time_days,
          default_assignee_type = excluded.default_assignee_type,
          default_rider_id = excluded.default_rider_id,
          default_partner_id = excluded.default_partner_id,
          updated_at = now()
        returning id
      `;
      townshipIds.push(row.id);
    }

    for (const order of orderDefinitions) {
      const riderId =
        order.assigneeType === 'RIDER' && order.assigneeIndex !== null
          ? riderIds[order.assigneeIndex]
          : null;
      const partnerId =
        order.assigneeType === 'PARTNER' && order.assigneeIndex !== null
          ? partnerIds[order.assigneeIndex]
          : null;
      const deliveredAt = ['AWAITING_APPROVAL', 'DELIVERED'].includes(
        order.status,
      )
        ? new Date()
        : null;
      const [orderRow] = await transaction<{ id: string }[]>`
        insert into orders (
          tracking_code, shop_id, customer_id, township_id, assignee_type, rider_id, partner_id,
          package_price, delivery_fee, is_package_paid_to_shop, is_fee_paid_to_shop,
          partner_fee, commission_fee, estimated_delivery_date, delivered_at, delivery_address, cancel_reason, status, notes
        )
        values (
          ${order.trackingCode}, ${shopIds[order.shopIndex]}, ${customerIds[order.customerIndex]},
          ${townshipIds[order.townshipIndex]}, ${order.assigneeType}, ${riderId}, ${partnerId},
          ${order.packagePrice}, ${order.deliveryFee}, ${order.isPackagePaidToShop}, ${order.isFeePaidToShop},
          ${order.assigneeType === 'PARTNER' ? '500.00' : '0.00'},
          ${order.assigneeType === 'RIDER' ? townshipDefinitions[order.townshipIndex].commission : '0.00'},
           current_date + ${townshipDefinitions[order.townshipIndex].leadTimeDays + ('estimatedDateOffset' in order ? order.estimatedDateOffset ?? 0 : 0)}::int,
          ${deliveredAt}, ${customerDefinitions[order.customerIndex].address},
          ${order.status === 'CANCELLED' ? 'Demo cancellation' : null}, ${order.status}, ${order.notes}
        )
        on conflict (tracking_code) do update set
          shop_id = excluded.shop_id,
          customer_id = excluded.customer_id,
          township_id = excluded.township_id,
          assignee_type = excluded.assignee_type,
          rider_id = excluded.rider_id,
          partner_id = excluded.partner_id,
          package_price = excluded.package_price,
          delivery_fee = excluded.delivery_fee,
          is_package_paid_to_shop = excluded.is_package_paid_to_shop,
          is_fee_paid_to_shop = excluded.is_fee_paid_to_shop,
          partner_fee = excluded.partner_fee,
          commission_fee = excluded.commission_fee,
           estimated_delivery_date = excluded.estimated_delivery_date,
          delivered_at = excluded.delivered_at,
          delivery_address = excluded.delivery_address,
          cancel_reason = excluded.cancel_reason,
          status = excluded.status,
          notes = excluded.notes,
          updated_at = now()
        returning id
      `;

      await transaction`delete from order_status_history where order_id = ${orderRow.id}`;
      for (const entry of historyForOrder(order, riderId, partnerId, riderIds[0] ?? '')) {
        await transaction`
          insert into order_status_history (
            order_id, from_status, to_status, changed_by, note, reason, internal_note, previous_assignee, new_assignee
          ) values (
            ${orderRow.id}, ${entry.fromStatus}, ${entry.toStatus}, ${owner?.id ?? null},
            ${entry.note}, ${entry.reason}, ${entry.internalNote}, ${entry.previousAssignee === null ? null : JSON.stringify(entry.previousAssignee)}::jsonb,
            ${entry.newAssignee === null ? null : JSON.stringify(entry.newAssignee)}::jsonb
          )
        `;
      }
    }
  });

  console.log('Demo seed complete. Demo logins use password: Password1234');
  for (const login of shopUserDefinitions) console.log(`SHOP ${login.email}`);
  for (const rider of riderDefinitions) console.log(`RIDER ${rider.email}`);
}

main()
  .catch((error: unknown) => {
    console.error('Demo seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
