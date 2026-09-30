-- A region's row, and how many blobs live in it, kept by the database itself:
-- whatever inserts a blob (a sign-up, a birth, the dev tools) opens its
-- region if new and counts it. AFTER, so a birth whose name was taken
-- (ON CONFLICT DO NOTHING) isn't counted.
CREATE FUNCTION count_blob() RETURNS trigger AS $$
BEGIN
  INSERT INTO regions (region, population) VALUES (NEW.region, 1)
  ON CONFLICT (region) DO UPDATE SET population = regions.population + 1;
  RETURN NULL;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER blobs_count AFTER INSERT ON blobs FOR EACH ROW EXECUTE FUNCTION count_blob();
