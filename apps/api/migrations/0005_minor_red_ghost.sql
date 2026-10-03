CREATE TABLE "milestones" (
	"seed" text NOT NULL,
	"region" integer NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"with_seed" text NOT NULL,
	"at" double precision NOT NULL,
	CONSTRAINT "milestones_seed_kind_key_pk" PRIMARY KEY("seed","kind","key")
);
