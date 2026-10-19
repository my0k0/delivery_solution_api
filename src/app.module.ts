import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { PermissionsModule } from './permissions/permissions.module.js';
import { RolesModule } from './roles/roles.module.js';
import { DatabaseModule } from './common/database/database.module.js';
import { HealthModule } from './common/health/health.module.js';
import { JwtAuthGuard } from './common/auth/auth.guard.js';
import { PermissionsGuard } from './common/auth/permissions.guard.js';
import { envValidation } from './config/env.validation.js';
import { ShopsModule } from './shops/shops.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { RidersModule } from './riders/riders.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { TownshipsModule } from './townships/townships.module.js';
import { DeliveryPartnersModule } from './delivery-partners/delivery-partners.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { RiderHandoversModule } from './rider-handovers/rider-handovers.module.js';
import { ShopPortalModule } from './shop-portal/shop-portal.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
      validate: envValidation,
    }),
    DatabaseModule,
    HealthModule,
    AuthModule,
    UsersModule,
    PermissionsModule,
    RolesModule,
    ShopsModule,
    CustomersModule,
    RidersModule,
    OrdersModule,
    TownshipsModule,
    DeliveryPartnersModule,
    ReportsModule,
    ShopPortalModule,
    RiderHandoversModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
  ],
})
export class AppModule {}
