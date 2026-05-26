-- Migration: Phase 2.2 — scene graph API supporting indexes
--> statement-breakpoint
CREATE INDEX "world_versions_world_id_status_idx" ON "world_versions" USING btree ("world_id","status");
--> statement-breakpoint
CREATE INDEX "world_versions_parent_version_id_idx" ON "world_versions" USING btree ("parent_version_id");
