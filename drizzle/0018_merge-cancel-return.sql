ALTER TABLE "orders" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'PENDING'::text;--> statement-breakpoint
ALTER TABLE "order_status_history" ALTER COLUMN "from_status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "order_status_history" ALTER COLUMN "to_status" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."order_status";--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('PENDING', 'ASSIGNED', 'AWAITING_APPROVAL', 'DELIVERED', 'CANCELLED');--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"public"."order_status";--> statement-breakpoint
-- Cancelled and returned are the same outcome for users, so legacy RETURNED orders become CANCELLED.
ALTER TABLE "orders" ALTER COLUMN "status" SET DATA TYPE "public"."order_status" USING (CASE WHEN "status" = 'RETURNED' THEN 'CANCELLED' ELSE "status" END)::"public"."order_status";--> statement-breakpoint
ALTER TABLE "order_status_history" ALTER COLUMN "from_status" SET DATA TYPE "public"."order_status" USING (CASE WHEN "from_status" = 'RETURNED' THEN 'CANCELLED' ELSE "from_status" END)::"public"."order_status";--> statement-breakpoint
ALTER TABLE "order_status_history" ALTER COLUMN "to_status" SET DATA TYPE "public"."order_status" USING (CASE WHEN "to_status" = 'RETURNED' THEN 'CANCELLED' ELSE "to_status" END)::"public"."order_status";