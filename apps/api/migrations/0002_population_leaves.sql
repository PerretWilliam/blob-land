-- A deleted account's blob leaves its region: counted out as it was counted in.
CREATE FUNCTION uncount_blob() RETURNS trigger AS $$
BEGIN
  UPDATE regions SET population = population - 1 WHERE region = OLD.region;
  RETURN NULL;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER blobs_uncount AFTER DELETE ON blobs FOR EACH ROW EXECUTE FUNCTION uncount_blob();
