-- Migration: Slice 7.2 — Postgres FTS for search
--> statement-breakpoint
ALTER TABLE "worlds" ADD COLUMN "search_vector" tsvector;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION worlds_search_vector_build(world_id_in uuid) RETURNS tsvector AS $$
DECLARE
  tag_names text;
  title_val text;
  desc_val text;
BEGIN
  SELECT w.title, coalesce(w.description, '') INTO title_val, desc_val FROM worlds w WHERE w.id = world_id_in;
  SELECT coalesce(string_agg(t.name, ' '), '') INTO tag_names
    FROM world_tags wt JOIN tags t ON t.id = wt.tag_id WHERE wt.world_id = world_id_in;
  RETURN
    setweight(to_tsvector('english', title_val),    'A') ||
    setweight(to_tsvector('english', desc_val),     'B') ||
    setweight(to_tsvector('english', tag_names),    'A');
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION worlds_search_vector_trigger_fn() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := worlds_search_vector_build(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER worlds_search_vector_trigger
BEFORE INSERT OR UPDATE OF title, description ON worlds
FOR EACH ROW EXECUTE FUNCTION worlds_search_vector_trigger_fn();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION world_tags_search_vector_trigger_fn() RETURNS trigger AS $$
DECLARE
  target_world_id uuid;
BEGIN
  target_world_id := COALESCE(NEW.world_id, OLD.world_id);
  UPDATE worlds SET search_vector = worlds_search_vector_build(target_world_id) WHERE id = target_world_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER world_tags_search_vector_trigger
AFTER INSERT OR DELETE ON world_tags
FOR EACH ROW EXECUTE FUNCTION world_tags_search_vector_trigger_fn();
--> statement-breakpoint
UPDATE worlds SET title = title;
--> statement-breakpoint
CREATE INDEX worlds_search_vector_gin ON worlds USING gin(search_vector);
