-- Migration: Slice 4 — comments + reposts tables
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"world_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reposts" (
	"user_id" uuid NOT NULL,
	"world_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reposts_user_id_world_id_pk" PRIMARY KEY("user_id","world_id")
);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reposts" ADD CONSTRAINT "reposts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reposts" ADD CONSTRAINT "reposts_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "comments_world_id_created_at_idx" ON "comments" USING btree ("world_id","created_at" DESC);
--> statement-breakpoint
CREATE INDEX "reposts_user_id_created_at_idx" ON "reposts" USING btree ("user_id","created_at" DESC);
