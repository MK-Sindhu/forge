-- Migration: Slice 5 — world_updates table (text-only v1)
--> statement-breakpoint
CREATE TABLE "world_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"world_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "world_updates" ADD CONSTRAINT "world_updates_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "world_updates_world_id_created_at_idx" ON "world_updates" USING btree ("world_id","created_at" DESC);
