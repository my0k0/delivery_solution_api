ALTER TABLE "orders" ADD COLUMN "shop_advance_amount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shop_advanced_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "orders_shop_advance_idx" ON "orders" USING btree ("shop_id","shop_advanced_at");