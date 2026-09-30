CREATE TABLE "blobs" (
	"seed" text PRIMARY KEY NOT NULL,
	"owner_user_id" uuid,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"region" integer NOT NULL,
	"country" text,
	"visible" boolean DEFAULT true NOT NULL,
	"traits" text,
	"parent_union_id" text,
	"born_at" double precision NOT NULL,
	"adult_at" double precision NOT NULL,
	"sex" text NOT NULL,
	"attraction" text NOT NULL,
	"personality" text NOT NULL,
	"energy" double precision NOT NULL,
	"mood" double precision NOT NULL,
	"last" text NOT NULL,
	CONSTRAINT "blobs_owner_user_id_unique" UNIQUE("owner_user_id"),
	CONSTRAINT "blobs_name_key_unique" UNIQUE("name_key")
);
--> statement-breakpoint
CREATE TABLE "dev_clock" (
	"id" integer PRIMARY KEY NOT NULL,
	"real_at" double precision NOT NULL,
	"garden_at" double precision NOT NULL,
	"scale" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interactions" (
	"id" text PRIMARY KEY NOT NULL,
	"region" integer NOT NULL,
	"seed_a" text NOT NULL,
	"seed_b" text NOT NULL,
	"kind" text NOT NULL,
	"outcome" text NOT NULL,
	"started_at" double precision NOT NULL,
	"ended_at" double precision NOT NULL,
	"rng" bigint NOT NULL,
	"d_friendship" double precision NOT NULL,
	"d_romance" double precision NOT NULL,
	"d_tension" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"region" integer PRIMARY KEY NOT NULL,
	"population" integer DEFAULT 0 NOT NULL,
	"step" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"next_step_at" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relationships" (
	"seed_a" text NOT NULL,
	"seed_b" text NOT NULL,
	"region" integer NOT NULL,
	"friendship" double precision NOT NULL,
	"romance" double precision NOT NULL,
	"tension" double precision NOT NULL,
	"chemistry" double precision NOT NULL,
	"status" text NOT NULL,
	"kin" text,
	"ex" boolean DEFAULT false NOT NULL,
	"meetings" integer DEFAULT 0 NOT NULL,
	"last_met_at" double precision,
	CONSTRAINT "relationships_seed_a_seed_b_pk" PRIMARY KEY("seed_a","seed_b")
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"seed" text NOT NULL,
	"region" integer NOT NULL,
	"start_at" double precision NOT NULL,
	"end_at" double precision NOT NULL,
	"activity" text NOT NULL,
	"expression" text NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"rng" bigint NOT NULL,
	"with_seed" text,
	"detail" text,
	"step" integer NOT NULL,
	CONSTRAINT "segments_seed_start_at_pk" PRIMARY KEY("seed","start_at")
);
--> statement-breakpoint
CREATE TABLE "unions" (
	"id" text PRIMARY KEY NOT NULL,
	"region" integer NOT NULL,
	"seed_a" text NOT NULL,
	"seed_b" text NOT NULL,
	"started_at" double precision NOT NULL,
	"ended_at" double precision,
	"last_birth_at" double precision
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pseudo" text NOT NULL,
	"seed" text NOT NULL,
	"password_hash" text NOT NULL,
	"password_salt" text NOT NULL,
	"last_seen_at" double precision NOT NULL,
	"created_at" double precision NOT NULL,
	CONSTRAINT "users_seed_unique" UNIQUE("seed")
);
--> statement-breakpoint
ALTER TABLE "blobs" ADD CONSTRAINT "blobs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blobs_region" ON "blobs" USING btree ("region","born_at");--> statement-breakpoint
CREATE INDEX "blobs_parent" ON "blobs" USING btree ("parent_union_id");--> statement-breakpoint
CREATE INDEX "interactions_region_end" ON "interactions" USING btree ("region","ended_at");--> statement-breakpoint
CREATE INDEX "regions_due" ON "regions" USING btree ("next_step_at");--> statement-breakpoint
CREATE INDEX "relationships_b" ON "relationships" USING btree ("seed_b");--> statement-breakpoint
CREATE INDEX "relationships_region" ON "relationships" USING btree ("region");--> statement-breakpoint
CREATE INDEX "segments_region_end" ON "segments" USING btree ("region","end_at");--> statement-breakpoint
CREATE INDEX "segments_region_step" ON "segments" USING btree ("region","step");--> statement-breakpoint
CREATE UNIQUE INDEX "unions_active_a" ON "unions" USING btree ("seed_a") WHERE ended_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "unions_active_b" ON "unions" USING btree ("seed_b") WHERE ended_at IS NULL;--> statement-breakpoint
CREATE INDEX "unions_a" ON "unions" USING btree ("seed_a");--> statement-breakpoint
CREATE INDEX "unions_b" ON "unions" USING btree ("seed_b");--> statement-breakpoint
CREATE INDEX "unions_region" ON "unions" USING btree ("region");