CREATE TYPE "public"."handover_method" AS ENUM('KPAY', 'CASH', 'BANK_TRANSFER');--> statement-breakpoint
CREATE TABLE "rider_handovers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rider_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"received_on" date NOT NULL,
	"method" "handover_method" NOT NULL,
	"note" text,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rider_handovers_amount_non_negative" CHECK ("rider_handovers"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "rider_handover_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handover_id" uuid NOT NULL,
	"field" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"actor_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rider_handovers" ADD CONSTRAINT "rider_handovers_rider_id_riders_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."riders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_handovers" ADD CONSTRAINT "rider_handovers_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_handover_audit" ADD CONSTRAINT "rider_handover_audit_handover_id_rider_handovers_id_fk" FOREIGN KEY ("handover_id") REFERENCES "public"."rider_handovers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_handover_audit" ADD CONSTRAINT "rider_handover_audit_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rider_handovers_rider_received_idx" ON "rider_handovers" USING btree ("rider_id","received_on");--> statement-breakpoint
CREATE INDEX "rider_handovers_received_idx" ON "rider_handovers" USING btree ("received_on");--> statement-breakpoint
CREATE INDEX "rider_handover_audit_handover_created_idx" ON "rider_handover_audit" USING btree ("handover_id","created_at");--> statement-breakpoint
CREATE INDEX "rider_handover_audit_actor_idx" ON "rider_handover_audit" USING btree ("actor_id");