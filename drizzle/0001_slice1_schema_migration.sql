-- Migration: Slice 1 schema changes
-- - users: add tos_accepted_at
-- - worlds: drop scene_json, drop thumbnail_url, rename likes -> likes_count,
--           add glb_url, add glb_size_bytes
-- - world_media: create new table with FK + CHECK constraint + composite index
-- Note: worlds table is empty at time of migration; RENAME COLUMN is safe.

--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tos_accepted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "worlds" DROP COLUMN "scene_json";
--> statement-breakpoint
ALTER TABLE "worlds" DROP COLUMN "thumbnail_url";
--> statement-breakpoint
ALTER TABLE "worlds" RENAME COLUMN "likes" TO "likes_count";
--> statement-breakpoint
ALTER TABLE "worlds" ADD COLUMN "glb_url" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "worlds" ADD COLUMN "glb_size_bytes" integer NOT NULL;
--> statement-breakpoint
CREATE TABLE "world_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"world_id" uuid NOT NULL,
	"type" text NOT NULL,
	"url" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "world_media_type_check" CHECK (type IN ('thumbnail', 'image', 'video'))
);
--> statement-breakpoint
ALTER TABLE "world_media" ADD CONSTRAINT "world_media_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "world_media_world_id_position_idx" ON "world_media" USING btree ("world_id","position");
