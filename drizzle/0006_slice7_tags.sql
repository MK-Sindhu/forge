-- Migration: Slice 7.1 — tags + world_tags
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_name_check" CHECK (length(name) BETWEEN 1 AND 32 AND name = lower(name)),
	CONSTRAINT "tags_name_unique" UNIQUE ("name")
);
--> statement-breakpoint
CREATE TABLE "world_tags" (
	"world_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "world_tags_world_id_tag_id_pk" PRIMARY KEY ("world_id", "tag_id")
);
--> statement-breakpoint
ALTER TABLE "world_tags" ADD CONSTRAINT "world_tags_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "world_tags" ADD CONSTRAINT "world_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "world_tags_tag_id_idx" ON "world_tags" USING btree ("tag_id");
