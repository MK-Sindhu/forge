-- Migration: Phase 2.1 — scene graph foundation
--> statement-breakpoint
ALTER TABLE "worlds" ADD COLUMN "scene_graph" jsonb;
--> statement-breakpoint
ALTER TABLE "worlds" ADD COLUMN "published_version_id" uuid;
--> statement-breakpoint
CREATE TABLE "world_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"world_id" uuid NOT NULL,
	"uploader_id" uuid NOT NULL,
	"name" text NOT NULL,
	"glb_url" text NOT NULL,
	"glb_size_bytes" integer NOT NULL,
	"kind" text DEFAULT 'glb' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "world_assets_kind_check" CHECK (kind IN ('glb'))
);
--> statement-breakpoint
ALTER TABLE "world_assets" ADD CONSTRAINT "world_assets_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "world_assets" ADD CONSTRAINT "world_assets_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "world_assets_world_id_created_at_idx" ON "world_assets" USING btree ("world_id","created_at" DESC);
--> statement-breakpoint
CREATE TABLE "world_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"world_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"scene_graph" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"label" text,
	"parent_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "world_versions_status_check" CHECK (status IN ('draft', 'published')),
	CONSTRAINT "world_versions_world_version_unique" UNIQUE ("world_id","version_number")
);
--> statement-breakpoint
ALTER TABLE "world_versions" ADD CONSTRAINT "world_versions_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "world_versions" ADD CONSTRAINT "world_versions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "world_versions" ADD CONSTRAINT "world_versions_parent_version_id_world_versions_id_fk" FOREIGN KEY ("parent_version_id") REFERENCES "public"."world_versions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "worlds" ADD CONSTRAINT "worlds_published_version_id_world_versions_id_fk" FOREIGN KEY ("published_version_id") REFERENCES "public"."world_versions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "world_versions_world_id_version_idx" ON "world_versions" USING btree ("world_id","version_number" DESC);
