CREATE TABLE "profile_media" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"media_type" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"blob_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "profile_media_user_idx" ON "profile_media" ("user_id");
--> statement-breakpoint
CREATE INDEX "profile_media_user_type_idx" ON "profile_media" ("user_id","media_type");
