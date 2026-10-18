ALTER TABLE "townships" DROP CONSTRAINT "townships_default_assignee_consistency_check";--> statement-breakpoint
ALTER TABLE "townships" DROP CONSTRAINT "townships_default_rider_id_riders_id_fk";
--> statement-breakpoint
ALTER TABLE "townships" DROP CONSTRAINT "townships_default_partner_id_delivery_partners_id_fk";
--> statement-breakpoint
DROP INDEX "townships_default_rider_idx";--> statement-breakpoint
DROP INDEX "townships_default_partner_idx";--> statement-breakpoint
ALTER TABLE "townships" DROP COLUMN "default_assignee_type";--> statement-breakpoint
ALTER TABLE "townships" DROP COLUMN "default_rider_id";--> statement-breakpoint
ALTER TABLE "townships" DROP COLUMN "default_partner_id";--> statement-breakpoint
DROP TYPE "public"."township_default_assignee_type";