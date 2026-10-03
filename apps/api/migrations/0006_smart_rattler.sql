ALTER TABLE "blobs" ADD COLUMN "away_from" integer;--> statement-breakpoint
ALTER TABLE "blobs" ADD COLUMN "stay_until" double precision;--> statement-breakpoint
ALTER TABLE "regions" ADD COLUMN "host" text;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_host_unique" UNIQUE("host");--> statement-breakpoint
-- A blob moving between regions (to an island and back) is counted out of
-- one and into the other, opening the other's row if new.
CREATE FUNCTION move_blob() RETURNS trigger AS $$
BEGIN
  UPDATE regions SET population = population - 1 WHERE region = OLD.region;
  INSERT INTO regions (region, population) VALUES (NEW.region, 1)
  ON CONFLICT (region) DO UPDATE SET population = regions.population + 1;
  RETURN NULL;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER blobs_move AFTER UPDATE OF region ON blobs FOR EACH ROW WHEN (OLD.region IS DISTINCT FROM NEW.region) EXECUTE FUNCTION move_blob();
