-- Migration: Slice 7.3 — per-user-per-day view tracking
--> statement-breakpoint
CREATE TABLE "world_views" (
	"viewer_id" uuid NOT NULL,
	"world_id" uuid NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "world_views_viewer_id_world_id_day_pk" PRIMARY KEY ("viewer_id", "world_id", "day")
);
--> statement-breakpoint
ALTER TABLE "world_views" ADD CONSTRAINT "world_views_viewer_id_users_id_fk" FOREIGN KEY ("viewer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "world_views" ADD CONSTRAINT "world_views_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "world_views_world_id_idx" ON "world_views" USING btree ("world_id");
