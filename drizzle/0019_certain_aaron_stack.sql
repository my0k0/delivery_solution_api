-- Rider commission moves from the per-way snapshot to a per-order column.
-- Order matters: add the columns, backfill from the way snapshot, then drop the
-- way relation. Partner orders never had a way, so they keep the '0' default.
ALTER TABLE "townships" ADD COLUMN "default_commission_fee" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "commission_fee" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
UPDATE "orders"
SET "commission_fee" = "ways"."commission_rate"
FROM "ways"
WHERE "orders"."way_id" = "ways"."id";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_partner_way_consistency_check";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_way_id_ways_id_fk";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "way_id";--> statement-breakpoint
ALTER TABLE "ways" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "ways" CASCADE;--> statement-breakpoint
ALTER TABLE "riders" DROP COLUMN "commission_per_way_override";--> statement-breakpoint
DELETE FROM "app_settings" WHERE "key" = 'commissionPerWay';
