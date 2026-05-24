-- Migration: Slice 6 — moderation (reports table + users admin/suspended columns)
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"world_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"body" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_id" uuid,
	CONSTRAINT "reports_reason_check" CHECK (reason IN ('copyright', 'nsfw', 'abusive', 'spam', 'other')),
	CONSTRAINT "reports_status_check" CHECK (status IN ('open', 'resolved', 'dismissed')),
	CONSTRAINT "reports_reporter_world_unique" UNIQUE ("reporter_id", "world_id")
);
--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "reports_status_created_at_idx" ON "reports" USING btree ("status","created_at" DESC);
