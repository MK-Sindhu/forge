-- Migration: Slice 9.2 — world collaborators
--> statement-breakpoint
CREATE TABLE "world_collaborators" (
  "world_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" text NOT NULL DEFAULT 'editor',
  "added_at" timestamp DEFAULT now() NOT NULL,
  "added_by_id" uuid,
  CONSTRAINT "world_collaborators_pkey" PRIMARY KEY ("world_id", "user_id"),
  CONSTRAINT "world_collaborators_world_id_fk" FOREIGN KEY ("world_id") REFERENCES "worlds"("id") ON DELETE cascade,
  CONSTRAINT "world_collaborators_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade,
  CONSTRAINT "world_collaborators_added_by_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE set null,
  CONSTRAINT "world_collaborators_role_check" CHECK ("role" IN ('editor'))
);
--> statement-breakpoint
CREATE INDEX "world_collaborators_user_id_idx" ON "world_collaborators" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_type_check";
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check"
  CHECK ("type" IN ('like','comment','follow','new_world','collaborator_added'));
